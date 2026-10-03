# ShopEasy - Online Shopping Platform

A completely separated, clean 2-folder structure for your backend and frontend.

---

## 📁 Project Structure

```text
ANTI NODE/
├── backend/
│   ├── .env               # MongoDB Atlas URI & Secret
│   ├── package.json       # Backend dependencies & scripts
│   └── server.js          # Complete Backend API (Express, Mongoose, Socket.io)
│
├── frontend/
│   ├── index.html         # Complete Frontend UI
│   ├── package.json       # Frontend scripts
│   └── server.js          # Lightweight Frontend server (Port 3000)
│
├── ShopEasy.postman_collection.json # Postman testing collection
├── package.json           # Root convenience scripts
└── README.md
```

---

## 🚀 How to Run the Project (Step-by-Step)

### Step 1: Run the Backend
Open **Terminal 1**:
```bash
cd backend
npm start
```
*Output: `Backend Server running on http://localhost:5001` and `MongoDB Connected to Atlas ShopEasy DB`*

---

### Step 2: Run the Frontend
Open **Terminal 2**:
```bash
cd frontend
npm start
```
*Output: `Frontend running at http://localhost:3000`*

---

### Step 3: Open in Browser
Visit:
```
http://localhost:3000
```
Your frontend is now running on port **3000** and talking to your backend on port **5001** with live MongoDB Atlas connection and real-time Socket.io inventory updates!
