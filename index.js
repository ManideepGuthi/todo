const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const session = require("express-session");
const MongoStore = require("connect-mongo"); // Added MongoStore
const multer = require("multer");
const fs = require("fs");
const http = require("http");
const socketio = require("socket.io");

const User = require("./models/User");
const Task = require("./models/Task");
const Room = require("./models/Room");
const Message = require("./models/Message");
const SharedTask = require("./models/SharedTask");

const app = express();
const server = http.createServer(app);
// NOTE: We need to attach Socket.IO to the http server, not the express app.
const io = socketio(server);

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

// -------------------- MongoDB Connection --------------------
const mongoURI =
  process.env.MONGO_URI ||
  "mongodb+srv://manideep:manu@todocluster.h76u0nm.mongodb.net/tododb?retryWrites=true&w=majority&appName=TodoCluster";

mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ Mongo Error:", err));

// -------------------- Sessions --------------------
// We create a shared session middleware instance here
const sharedSession = session({
  secret: "secret_key_321",
  resave: false,
  saveUninitialized: true,
  store: MongoStore.create({
    client: mongoose.connection.getClient(),
    dbName: 'tododb',
    collectionName: 'sessions',
    ttl: 14 * 24 * 60 * 60, // 14 days
  }),
  cookie: { secure: false }, // set true only with HTTPS
});
app.use(sharedSession); // Apply the middleware to Express

// -------------------- Socket.io Integration --------------------
// This is the CRITICAL fix. We tell Socket.IO to use the same session middleware.
// This makes the session available on `socket.request.session`.
io.engine.use(sharedSession);

// Make user available in all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

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

    // This is the fix: Use .populate('room') to fetch the room data
    const tasks = await Task.find(query).populate('room').sort(sortOptions);

    // Fetch rooms and count tasks for the sidebar
    const rooms = await Room.find({});
    for (const room of rooms) {
      room.taskCount = await Task.countDocuments({ room: room._id });
    }
    
    // Fetch shared tasks sent by the current user
    const sentTasks = await SharedTask.find({ sender: req.session.user.id }).populate('receiver', 'name');
    
    res.render("dashboard", {
      tasks,
      sentTasks,
      rooms, // Pass the rooms to the template
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
    const { title, description, tags, priority, room } = req.body;
    const taskTags = tags ? tags.split(",").map((t) => t.trim()) : [];

    await Task.create({
      title,
      description,
      tags: taskTags,
      priority,
      user: req.session.user.id,
      status: "pending",
      room: room || null, // Assign the room ID if provided
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
      const { title, description, tags, priority, deadline, room } = req.body;
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
        room: room || null, // Assign the room ID if provided
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
    const { title, description, tags, priority, room } = req.body;
    const taskTags = tags ? tags.split(",").map((t) => t.trim()) : [];

    await Task.findByIdAndUpdate(req.params.id, {
      title,
      description,
      tags: taskTags,
      priority,
      room: room || null,
    });
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("Error editing task");
  }
});

// Mark complete
app.post("/tasks/complete/:id", isAuthenticated, async (req, res) => {
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
app.post("/tasks/delete/:id", isAuthenticated, async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (task && task.attachment && task.attachment.filePath) {
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

    // Fetch shared tasks sent by the current user
    let sharedTasks = [];
    try {
      sharedTasks = await SharedTask.find({ sender: req.session.user.id }).populate('receiver', 'name').sort({ createdAt: -1 });
      console.log('Shared tasks found:', sharedTasks.length);
    } catch (sharedTaskErr) {
      console.error('Error fetching shared tasks:', sharedTaskErr);
      sharedTasks = [];
    }

    // Data for charts - Combine personal and shared tasks
    const completedPersonalTasks = tasks.filter(t => t.status === 'completed').length;
    const pendingPersonalTasks = tasks.filter(t => t.status === 'pending').length;
    const completedSharedTasks = sharedTasks.filter(t => t.completed === true).length;
    const pendingSharedTasks = sharedTasks.filter(t => t.completed === false).length;

    // Combined totals
    const totalCompleted = completedPersonalTasks + completedSharedTasks;
    const totalPending = pendingPersonalTasks + pendingSharedTasks;

    const priorityCounts = {
      'Low': 0,
      'Medium': 0,
      'High': 0,
    };

    // Count priorities from personal tasks
    tasks.forEach(t => {
      if (t.priority) {
        priorityCounts[t.priority]++;
      } else {
        priorityCounts['Low']++;
      }
    });

    // Shared tasks don't have priority field, so we'll categorize them as 'Medium' by default
    // or we could add a priority field to SharedTask model later
    const sharedTasksCount = sharedTasks.length;
    priorityCounts['Medium'] += sharedTasksCount;

    const tasksByDay = {};
    const sharedTasksByDay = {};

    // Count personal tasks by day
    tasks.forEach(t => {
      const date = new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      tasksByDay[date] = (tasksByDay[date] || 0) + 1;
    });

    // Count shared tasks by day
    sharedTasks.forEach(t => {
      const date = new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      sharedTasksByDay[date] = (sharedTasksByDay[date] || 0) + 1;
    });

    // Combine both personal and shared tasks for timeline
    const combinedTasksByDay = {};
    Object.keys(tasksByDay).forEach(date => {
      combinedTasksByDay[date] = tasksByDay[date];
    });
    Object.keys(sharedTasksByDay).forEach(date => {
      combinedTasksByDay[date] = (combinedTasksByDay[date] || 0) + sharedTasksByDay[date];
    });

    console.log('Rendering visualize with sharedTasks:', sharedTasks ? sharedTasks.length : 'undefined');

    res.render("visualize", {
      data: {
        // Combined data for main charts
        taskStatus: [totalPending, totalCompleted],
        taskPriorities: [priorityCounts['Low'], priorityCounts['Medium'], priorityCounts['High']],
        tasksOverTime: combinedTasksByDay,

        // Separate breakdowns for detailed analysis
        personalTasks: {
          status: [pendingPersonalTasks, completedPersonalTasks],
          count: tasks.length
        },
        sharedTasks: {
          status: [pendingSharedTasks, completedSharedTasks],
          count: sharedTasks.length,
          byDay: sharedTasksByDay
        }
      },
      tasks: tasks || [],
      sharedTasks: sharedTasks || []
    });
  } catch (err) {
    console.error('Error in visualize route:', err);
    res.send("Error loading visualizations");
  }
});

// Profile routes
app.get("/profile", isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.user.id);

    // Get task statistics
    const totalTasks = await Task.countDocuments({ user: req.session.user.id });
    const completedTasks = await Task.countDocuments({ user: req.session.user.id, status: 'completed' });
    const pendingTasks = await Task.countDocuments({ user: req.session.user.id, status: 'pending' });
    const overdueTasks = await Task.countDocuments({
      user: req.session.user.id,
      status: 'pending',
      deadline: { $lt: new Date() }
    });

    // Get project count (rooms)
    const projectCount = await Room.countDocuments({});

    // Get recent activities (last 5 tasks)
    const recentActivities = await Task.find({ user: req.session.user.id })
      .sort({ updatedAt: -1 })
      .limit(5)
      .select('title description status updatedAt');

    // Handle success/error messages from query parameters
    const success = req.query.success;
    const error = req.query.error;

    res.render("profile", {
      user,
      taskCount: totalTasks,
      completedTasks,
      pendingTasks,
      overdueTasks,
      projectCount,
      recentActivities: recentActivities.map(activity => ({
        title: activity.title,
        description: activity.description || 'No description',
        type: activity.status === 'completed' ? 'Completed' : 'Updated',
        createdAt: activity.updatedAt
      })),
      success,
      error
    });
  } catch (err) {
    console.error(err);
    res.send("Error loading profile");
  }
});

// Update profile
app.post("/profile/update", isAuthenticated, async (req, res) => {
  try {
    const { name, username } = req.body;

    // Check if username is already taken by another user
    const existingUser = await User.findOne({ username, _id: { $ne: req.session.user.id } });
    if (existingUser) {
      return res.redirect("/profile?error=Username already taken");
    }

    await User.findByIdAndUpdate(req.session.user.id, { name, username });

    // Update session
    req.session.user.name = name;
    req.session.user.username = username;

    res.redirect("/profile?success=Profile updated successfully");
  } catch (err) {
    console.error(err);
    res.redirect("/profile?error=Error updating profile");
  }
});

// Change password
app.post("/profile/change-password", isAuthenticated, async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmNewPassword } = req.body;

    if (newPassword !== confirmNewPassword) {
      return res.redirect("/profile?error=New passwords do not match");
    }

    const user = await User.findById(req.session.user.id);
    if (user.password !== oldPassword) {
      return res.redirect("/profile?error=Old password is incorrect");
    }

    await User.findByIdAndUpdate(req.session.user.id, { password: newPassword });

    res.redirect("/profile?success=Password changed successfully");
  } catch (err) {
    console.error(err);
    res.redirect("/profile?error=Error changing password");
  }
});

// Upload profile photo
app.post("/profile/upload-photo", isAuthenticated, upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.redirect("/profile?error=No file uploaded");
    }

    const profilePicture = `/uploads/${req.file.filename}`;

    await User.findByIdAndUpdate(req.session.user.id, { profilePicture });

    res.redirect("/profile?success=Profile picture updated successfully");
  } catch (err) {
    console.error(err);
    res.redirect("/profile?error=Error uploading profile picture");
  }
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/signin"));
});

// Collaboration routes
app.get("/connect", isAuthenticated, async (req, res) => {
  try {
    const rooms = await Room.find({});
    res.render("connect", { rooms });
  } catch (err) {
    console.error(err);
    res.send("Error loading connect page");
  }
});

app.post("/rooms", isAuthenticated, async (req, res) => {
  const { roomName } = req.body;
  try {
    const existingRoom = await Room.findOne({ name: roomName });
    if (!existingRoom) {
      const newRoom = new Room({ name: roomName });
      await newRoom.save();
    }
    res.redirect("/connect");
  } catch (err) {
    console.error(err);
    res.send("Error creating room");
  }
});

app.post("/rooms/delete/:roomName", isAuthenticated, async (req, res) => {
  const { roomName } = req.params;
  try {
    const room = await Room.findOne({ name: roomName });
    if (!room) {
      return res.status(404).send("Room not found");
    }

    // Delete associated messages and shared tasks
    await Message.deleteMany({ roomName });
    await SharedTask.deleteMany({ roomName });

    // Delete the room
    await Room.deleteOne({ name: roomName });

    // Notify all users in the room to leave
    io.to(roomName).emit('room deleted', roomName);

    res.redirect("/connect");
  } catch (err) {
    console.error(err);
    res.send("Error deleting room");
  }
});

// Add shared task
app.post("/rooms/add-shared-task", isAuthenticated, upload.single('attachment'), async (req, res) => {
  try {
    const { roomName, task, deadline } = req.body;
    const sender = req.session.user.id;

    console.log('Add shared task request:', { roomName, task, deadline, sender });

    // Validate required fields
    if (!task || !task.trim()) {
      return res.status(400).json({ success: false, message: "Task description is required" });
    }

    if (!roomName || !roomName.trim()) {
      return res.status(400).json({ success: false, message: "Room name is required" });
    }

    // Check if room exists
    const room = await Room.findOne({ name: roomName });
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    let attachment = null;
    if (req.file) {
      attachment = {
        fileName: req.file.originalname,
        filePath: `/uploads/${req.file.filename}`,
        mimetype: req.file.mimetype,
      };
    }

    const newSharedTask = new SharedTask({
      task: task.trim(),
      sender,
      roomName: roomName.trim(),
      deadline: deadline ? new Date(deadline) : null,
      attachment
    });
    await newSharedTask.save();

    // Emit updated task list to the room
    const tasks = await SharedTask.find({ roomName: roomName.trim() }).populate('sender', 'name').populate('receiver', 'name');
    io.to(roomName.trim()).emit('task update', tasks);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error adding shared task:', err);
    res.status(500).json({ success: false, message: "Error adding shared task" });
  }
});

// Edit shared task
app.post("/rooms/edit-shared-task/:id", isAuthenticated, async (req, res) => {
  try {
    const { task, deadline } = req.body;
    const sharedTask = await SharedTask.findById(req.params.id);
    if (!sharedTask) {
      return res.status(404).send("Task not found");
    }

    if (sharedTask.sender.toString() !== req.session.user.id.toString()) {
      return res.status(403).send("Unauthorized");
    }

    sharedTask.task = task;
    sharedTask.deadline = deadline ? new Date(deadline) : null;
    await sharedTask.save();

    const tasks = await SharedTask.find({ roomName: sharedTask.roomName }).populate('sender', 'name').populate('receiver', 'name');
    io.to(sharedTask.roomName).emit('task update', tasks);

    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error editing task");
  }
});

// Delete shared task
app.post("/rooms/delete-shared-task/:id", isAuthenticated, async (req, res) => {
  try {
    const sharedTask = await SharedTask.findById(req.params.id);
    if (!sharedTask) {
      return res.status(404).send("Task not found");
    }

    if (sharedTask.sender.toString() !== req.session.user.id.toString()) {
      return res.status(403).send("Unauthorized");
    }

    const roomName = sharedTask.roomName;
    if (sharedTask.attachment && sharedTask.attachment.filePath) {
      const filePath = path.join(__dirname, sharedTask.attachment.filePath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await sharedTask.deleteOne();

    const tasks = await SharedTask.find({ roomName }).populate('sender', 'name').populate('receiver', 'name');
    io.to(roomName).emit('task update', tasks);

    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error deleting task");
  }
});

// Accept shared task
app.post("/rooms/accept-task/:id", isAuthenticated, async (req, res) => {
  try {
    const sharedTask = await SharedTask.findById(req.params.id);
    if (!sharedTask) {
      return res.status(404).send("Task not found");
    }

    sharedTask.receiver = req.session.user.id;
    await sharedTask.save();

    const room = await Room.findOne({ name: sharedTask.roomName });
    room.sharedTasks.pull(sharedTask._id);
    await room.save();

    const tasks = await SharedTask.find({ roomName: sharedTask.roomName }).populate('sender', 'name').populate('receiver', 'name');
    io.to(sharedTask.roomName).emit('task update', tasks);
    
    // Notify chat that the task was accepted
    io.to(sharedTask.roomName).emit('chat message', {
      username: 'System',
      message: `${req.session.user.name} has accepted the task: "${sharedTask.task}".`,
      isSystem: true
    });

    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error accepting task");
  }
});

// Decline shared task
app.post("/rooms/decline-task/:id", isAuthenticated, async (req, res) => {
  try {
    const sharedTask = await SharedTask.findById(req.params.id);
    if (!sharedTask) {
      return res.status(404).send("Task not found");
    }

    const roomName = sharedTask.roomName;
    
    await sharedTask.deleteOne();
    
    const tasks = await SharedTask.find({ roomName }).populate('sender', 'name').populate('receiver', 'name');
    io.to(roomName).emit('task update', tasks);

    io.to(roomName).emit('chat message', {
      username: 'System',
      message: `${req.session.user.name} has declined the task: "${sharedTask.task}".`,
      isSystem: true
    });
    
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error declining task");
  }
});

// Complete shared task
app.post("/rooms/complete-shared-task/:id", isAuthenticated, async (req, res) => {
  try {
    const sharedTask = await SharedTask.findById(req.params.id);
    if (!sharedTask) {
      return res.status(404).send("Task not found");
    }

    if (sharedTask.receiver.toString() !== req.session.user.id.toString()) {
      return res.status(403).send("Unauthorized");
    }

    sharedTask.completed = true;
    await sharedTask.save();

    const tasks = await SharedTask.find({ roomName: sharedTask.roomName }).populate('sender', 'name').populate('receiver', 'name');
    io.to(sharedTask.roomName).emit('task update', tasks);
    
    // Notify chat that the task was completed
    io.to(sharedTask.roomName).emit('chat message', {
      username: 'System',
      message: `${req.session.user.name} has completed the task: "${sharedTask.task}".`,
      isSystem: true
    });

    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error completing task");
  }
});

// Socket.io
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on('request room list', async () => {
    try {
      const rooms = await Room.find({});
      for (const room of rooms) {
        room.taskCount = await SharedTask.countDocuments({ roomName: room.name });
      }
      socket.emit('room list update', rooms);
    } catch (err) {
      console.error("Error fetching room list:", err);
      socket.emit('error', 'Failed to fetch room list.');
    }
  });

  socket.on('joinRoom', async (roomName) => {
    try {
      const room = await Room.findOne({ name: roomName });
      if (!room) {
        socket.emit('error', 'Room not found.');
        return;
      }

      // Add the user to the room in Socket.IO using roomName
      socket.join(roomName);
      // The session is now available on `socket.request.session`
      console.log(`User ${socket.request.session.user?._id} joined room ${roomName}`);

      // Notify other users in the room
      const username = socket.request.session.user?.name || 'A user';
      const message = {
        from: username,
        message: `${username} has joined the room.`,
        isSystem: true
      };
      io.to(roomName).emit('chat message', message);

      // Fetch and send the shared tasks to the joining user
      const sharedTasks = await SharedTask.find({ roomName: room.name }).populate('sender', 'name').populate('receiver', 'name');
      socket.emit('task update', sharedTasks);

    } catch (err) {
      console.error("Error joining room:", err);
      socket.emit('error', 'Failed to join room.');
    }
  });

  socket.on('request chat history', async (data) => {
    try {
      const { room, page = 0, limit = 1 } = data;
      const skip = page * limit;

      // Get messages in reverse chronological order (newest first)
      const messages = await Message.find({ roomName: room })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      // Reverse to chronological order for display
      messages.reverse();

      socket.emit('chat history', messages);
    } catch (err) {
      console.error("Error fetching chat history:", err);
      socket.emit('error', 'Failed to fetch chat history.');
    }
  });

  socket.on("leave room", async (roomName) => {
    socket.leave(roomName);
    console.log(`User ${socket.id} left room ${roomName}`);

    // Update the room's user list
    const room = await Room.findOne({ name: roomName });
    if (room && room.users.includes(socket.id)) {
      room.users.pull(socket.id);
      await room.save();
    }
    
    // Broadcast updated room list to all clients
    const rooms = await Room.find({});
    io.emit('room list update', rooms);

    // Notify chat
    if (socket.request.session && socket.request.session.user) {
      io.to(roomName).emit('chat message', {
        username: 'System',
        message: `${socket.request.session.user.name} has left the room.`,
        isSystem: true,
        isItalic: true
      });
    }
  });

  socket.on("chat message", async (data) => {
    const { room, message, username, userId } = data;
    const newMessage = new Message({
      roomName: room,
      username,
      message,
      userId,
      isSystem: false
    });
    await newMessage.save();

    io.to(room).emit("chat message", {
      room,
      message,
      username,
      userId,
      isSystem: false
    });
  });

  socket.on("disconnect", async () => {
    console.log("A user disconnected:", socket.id);
    const rooms = await Room.find({ users: socket.id });
    for (const room of rooms) {
      room.users.pull(socket.id);
      await room.save();
      // Broadcast updated room list to all clients
      const allRooms = await Room.find({});
      io.emit('room list update', allRooms);

      // Notify chat
      if (socket.request.session && socket.request.session.user) {
        io.to(room.name).emit('chat message', {
          username: 'System',
          message: `${socket.request.session.user.name} has left the room.`,
          isSystem: true,
          isItalic: true
        });
      }
    }
  });
});

// -------------------- Server --------------------
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
