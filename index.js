const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");

const User = require("./models/User");
const Task = require("./models/Task");

const app = express();
const PORT = 5000;

// -------------------- Middleware --------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads")); // Serve uploaded files

// Multer for file uploads
const upload = multer({ dest: "uploads/" });

// EJS setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Sessions
app.use(
  session({
    secret: "secret_key_321",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // set true only with HTTPS
  })
);

// Make user available in all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// -------------------- MongoDB Connection --------------------
mongoose
  .connect("mongodb://127.0.0.1:27017/todo")
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ Mongo Error:", err));

// -------------------- Middleware --------------------
function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect("/signin");
}

// -------------------- Routes --------------------
app.get("/", (req, res) => res.redirect("/signin"));

// SignUp
app.get("/signup", (req, res) => res.render("signup", { error: null }));

app.post("/signup", async (req, res) => {
  const { name, username, password, confirmPassword } = req.body;

  try {
    if (password !== confirmPassword) {
      return res.render("signup", { error: "Passwords do not match." });
    }

    const existing = await User.findOne({ username });
    if (existing) {
      return res.render("signup", { error: "Username already taken." });
    }

    // ⚠️ Plain password (you said no bcrypt)
    const newUser = new User({ name, username, password });
    await newUser.save();

    res.redirect("/signin");
  } catch (err) {
    console.error(err);
    res.render("signup", { error: "Something went wrong." });
  }
});

// SignIn
app.get("/signin", (req, res) => res.render("signin", { error: null }));

app.post("/signin", async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username, password });
    if (!user) {
      return res.render("signin", { error: "Invalid credentials." });
    }

    req.session.user = {
      id: user._id,
      name: user.name,
      username: user.username,
    };

    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.render("signin", { error: "Something went wrong." });
  }
});

// Dashboard
app.get("/dashboard", isAuthenticated, async (req, res) => {
  try {
    const { search, filterBy, sortBy } = req.query;
    let query = { user: req.session.user.id };

    // Search
    if (search) {
      const regex = new RegExp(search, "i");
      query.$or = [
        { title: { $regex: regex } },
        { description: { $regex: regex } },
        { tags: { $in: [regex] } },
      ];
    }

    // Filter
    if (filterBy === "pending") query.status = "pending";
    else if (filterBy === "completed") query.status = "completed";

    // Sort
    let sortOptions = { createdAt: -1 };
    if (sortBy === "priority") sortOptions = { priority: -1 };
    else if (sortBy === "deadline") sortOptions = { deadline: 1 };

    const tasks = await Task.find(query).sort(sortOptions);

    res.render("dashboard", {
      tasks,
      search: search || "",
      filterBy: filterBy || "",
      sortBy: sortBy || "",
    });
  } catch (err) {
    console.error(err);
    res.send("Error loading dashboard");
  }
});

// Add normal task
app.post("/tasks/add", isAuthenticated, async (req, res) => {
  try {
    const { title, description, tags, priority } = req.body;
    const taskTags = tags ? tags.split(",").map((t) => t.trim()) : [];

    await Task.create({
      title,
      description,
      tags: taskTags,
      priority,
      user: req.session.user.id,
      status: "pending",
    });

    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("Error adding task");
  }
});

// Add deadline task
app.post(
  "/tasks/add-deadline",
  isAuthenticated,
  upload.single("attachment"),
  async (req, res) => {
    try {
      const { title, description, tags, priority, deadline } = req.body;
      const taskTags = tags ? tags.split(",").map((t) => t.trim()) : [];

      let attachment = null;
      if (req.file) {
        attachment = {
          fileName: req.file.originalname,
          filePath: `/uploads/${req.file.filename}`,
          mimetype: req.file.mimetype,
        };
      }

      await Task.create({
        title,
        description,
        tags: taskTags,
        priority,
        deadline: deadline ? new Date(deadline) : null,
        attachment,
        user: req.session.user.id,
        status: "pending",
      });

      res.redirect("/dashboard");
    } catch (err) {
      console.error(err);
      res.send("Error adding deadline task");
    }
  }
);

// Edit task
app.post("/tasks/edit/:id", isAuthenticated, async (req, res) => {
  try {
    const { title, description, tags, priority } = req.body;
    const taskTags = tags ? tags.split(",").map((t) => t.trim()) : [];

    await Task.findByIdAndUpdate(req.params.id, {
      title,
      description,
      tags: taskTags,
      priority,
    });
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("Error editing task");
  }
});

// Mark complete
app.get("/tasks/complete/:id", isAuthenticated, async (req, res) => {
  try {
    await Task.findByIdAndUpdate(req.params.id, {
      status: "completed",
      completedAt: new Date(),
    });
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("Error completing task");
  }
});

// Delete task
app.get("/tasks/delete/:id", isAuthenticated, async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (task && task.attachment) {
      const filePath = path.join(__dirname, task.attachment.filePath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("Error deleting task");
  }
});

// New visualization route
app.get("/visualize", isAuthenticated, async (req, res) => {
  try {
    const tasks = await Task.find({ user: req.session.user.id });

    // Data for charts
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const pendingTasks = tasks.filter(t => t.status === 'pending').length;

    const priorityCounts = {
      'Low': 0,
      'Medium': 0,
      'High': 0,
    };
    tasks.forEach(t => {
      if (t.priority) {
        priorityCounts[t.priority]++;
      } else {
        priorityCounts['Low']++;
      }
    });

    const tasksByDay = {};
    tasks.forEach(t => {
      const date = new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      tasksByDay[date] = (tasksByDay[date] || 0) + 1;
    });

    res.render("visualize", {
      data: {
        taskStatus: [pendingTasks, completedTasks],
        taskPriorities: [priorityCounts['Low'], priorityCounts['Medium'], priorityCounts['High']],
        tasksOverTime: tasksByDay
      },
      tasks // This is the fix: passing the tasks array to the EJS template
    });
  } catch (err) {
    console.error(err);
    res.send("Error loading visualizations");
  }
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/signin"));
});

// -------------------- Server --------------------
// app.listen(PORT, () =>
//   console.log(`🚀 Server running at http://localhost:${PORT}`)
// );


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
