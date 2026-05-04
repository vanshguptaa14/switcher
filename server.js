require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(express.static('public')); 

// Serve login.html as the homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Database Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- SCHEMAS ---

// User Schema - Updated to store device status
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    // Tracks the ON/OFF state of your circular buttons
    deviceStatus: {
        devA: { type: String, default: "OFF" },
        devB: { type: String, default: "OFF" }
    }
});
const User = mongoose.model('User', userSchema);

// Timeline Schema for "Detect" Tab
const timelineSchema = new mongoose.Schema({
    value: { type: Number, required: true },
    unit: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});
const Timeline = mongoose.model('Timeline', timelineSchema);

// --- EMAIL SETUP ---

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { 
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    }
});

let tempOTPStore = {}; 

// --- API ROUTES ---

// 1. Send OTP
app.post('/send-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Email is required' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        tempOTPStore[email] = otp;

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Your Verification Code',
            text: `Your OTP is: ${otp}`
        });

        res.json({ message: 'OTP sent to email' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to send email' });
    }
});

// 2. Register
app.post('/register', async (req, res) => {
    try {
        const { name, email, password, otp } = req.body;
        if (!tempOTPStore[email] || tempOTPStore[email] !== otp) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        const newUser = new User({ name, email, password });
        await newUser.save();
        delete tempOTPStore[email];
        res.json({ success: true });
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ message: 'Email already registered.' });
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 3. Login
app.post('/login', async (req, res) => {
    try {
        const { name, password } = req.body;
        const user = await User.findOne({ name, password });
        if (user) {
            res.json({ success: true, name: user.name }); // Sending name back for frontend storage
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Login failed' });
    }
});

// 4. Reset Password
app.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        if (!tempOTPStore[email] || tempOTPStore[email] !== otp) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }
        const user = await User.findOneAndUpdate({ email }, { password: newPassword });
        if (!user) return res.status(404).json({ message: 'User not found' });
        delete tempOTPStore[email];
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Reset failed' });
    }
});

// 5. NEW: Save Device ON/OFF Status
app.post('/update-device-status', async (req, res) => {
    try {
        const { deviceId, status, name } = req.body; // deviceId is 'devA' or 'devB'
        
        const updateField = `deviceStatus.${deviceId}`;
        const user = await User.findOneAndUpdate(
            { name: name }, 
            { [updateField]: status },
            { new: true }
        );

        if (!user) return res.status(404).json({ message: 'User not found' });
        
        console.log(`✅ ${name}'s ${deviceId} updated to ${status}`);
        res.json({ success: true });
    } catch (error) {
        console.error("Status Update Error:", error);
        res.status(500).json({ success: false });
    }
});

// 6. Save Timeline Data
app.post('/save-timeline', async (req, res) => {
    try {
        const { value, unit } = req.body;
        if (!value || !unit) return res.status(400).json({ message: 'Missing data' });
        const newEntry = new Timeline({ value, unit });
        await newEntry.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Failed to save configuration' });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});