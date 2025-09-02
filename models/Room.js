const mongoose = require("mongoose");

const RoomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  users: [{
    type: String, // Store socket IDs
  }],
  sharedTasks: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SharedTask',
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Room", RoomSchema);