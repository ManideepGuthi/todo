const mongoose = require("mongoose");

const SharedTaskSchema = new mongoose.Schema({
  task: {
    type: String,
    required: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  roomName: {
    type: String,
    required: true,
  },
  deadline: {
    type: Date,
    default: null,
  },
  attachment: {
    fileName: String,
    filePath: String,
    mimetype: String,
  },
  completed: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("SharedTask", SharedTaskSchema);