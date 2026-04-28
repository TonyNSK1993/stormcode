const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function readDB() {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
}

function writeDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Авторизация
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const db = readDB();
    const user = Object.values(db.users).find(u => u.email === email && u.password === password);
    if (user) {
        const { password, ...safeUser } = user;
        res.json({ success: true, user: safeUser });
    } else {
        res.status(401).json({ success: false, message: 'Неверный email или пароль' });
    }
});

// Получить всех клиентов (только для админа)
app.get('/api/users', (req, res) => {
    const db = readDB();
    const clients = Object.values(db.users).filter(u => u.role === 'client');
    res.json(clients);
});

// Получить проекты
app.get('/api/projects', (req, res) => {
    const { clientId } = req.query;
    const db = readDB();
    let projects = db.projects;
    if (clientId) projects = projects.filter(p => p.clientId === clientId);
    res.json(projects);
});

// Создать проект
app.post('/api/projects', (req, res) => {
    const { clientId, name, description } = req.body;
    const db = readDB();
    const newProject = {
        id: Date.now().toString(),
        clientId,
        name,
        description,
        status: 'active',
        createdAt: new Date().toISOString().split('T')[0]
    };
    db.projects.push(newProject);
    writeDB(db);
    res.json(newProject);
});

// Получить задачи
app.get('/api/tasks', (req, res) => {
    const { clientId, projectId, status } = req.query;
    const db = readDB();
    let tasks = db.tasks;
    if (clientId) tasks = tasks.filter(t => t.clientId === clientId);
    if (projectId) tasks = tasks.filter(t => t.projectId === projectId);
    if (status) tasks = tasks.filter(t => t.status === status);
    res.json(tasks);
});

// Создать задачу
app.post('/api/tasks', (req, res) => {
    const { projectId, clientId, title, description, createdBy } = req.body;
    const db = readDB();
    const newTask = {
        id: Date.now().toString(),
        projectId,
        clientId,
        title,
        description,
        status: 'pending_estimate',
        estimated_hours: null,
        approved_hours: null,
        spent_hours: 0,
        createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    db.tasks.push(newTask);
    writeDB(db);
    res.json(newTask);
});

// Обновить задачу (оценка часов, согласование, списание)
app.put('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const db = readDB();
    const taskIndex = db.tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) return res.status(404).json({ error: 'Task not found' });
    
    db.tasks[taskIndex] = { ...db.tasks[taskIndex], ...updates, updatedAt: new Date().toISOString() };
    
    // Если задача согласована и по ней начали списывать часы
    if (updates.status === 'in_progress' && updates.approved_hours) {
        // Здесь можно логику списания часов
    }
    
    writeDB(db);
    res.json(db.tasks[taskIndex]);
});

// Списать часы с задачи
app.post('/api/tasks/:id/spend', (req, res) => {
    const { id } = req.params;
    const { hours } = req.body;
    const db = readDB();
    const task = db.tasks.find(t => t.id === id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    
    task.spent_hours = (task.spent_hours || 0) + hours;
    
    // Списать часы из пакета клиента
    const client = db.users[task.clientId];
    if (client && client.hours_package) {
        client.hours_used = (client.hours_used || 0) + hours;
    }
    
    if (task.spent_hours >= task.approved_hours) {
        task.status = 'completed';
    }
    
    writeDB(db);
    res.json({ task, client });
});

// Получить чат-сообщения
app.get('/api/messages', (req, res) => {
    const { projectId, userId } = req.query;
    const db = readDB();
    let messages = db.messages;
    if (projectId) messages = messages.filter(m => m.projectId === projectId);
    if (userId) messages = messages.filter(m => m.from === userId || m.to === userId);
    res.json(messages);
});

// Отправить сообщение
app.post('/api/messages', (req, res) => {
    const { projectId, from, to, text } = req.body;
    const db = readDB();
    const newMessage = {
        id: Date.now().toString(),
        projectId,
        from,
        to,
        text,
        timestamp: new Date().toISOString(),
        read: false
    };
    db.messages.push(newMessage);
    writeDB(db);
    res.json(newMessage);
});

// Купить пакет часов
app.post('/api/buy-hours', (req, res) => {
    const { clientId, hours } = req.body;
    const db = readDB();
    const client = db.users[clientId];
    if (!client) return res.status(404).json({ error: 'Client not found' });
    
    client.hours_package = (client.hours_package || 0) + hours;
    db.transactions.push({
        id: Date.now().toString(),
        clientId,
        amount: hours,
        type: 'buy_package',
        date: new Date().toISOString()
    });
    
    writeDB(db);
    res.json({ success: true, hours_package: client.hours_package });
});

// Статистика по клиенту
app.get('/api/client-stats/:clientId', (req, res) => {
    const { clientId } = req.params;
    const db = readDB();
    const client = db.users[clientId];
    const tasks = db.tasks.filter(t => t.clientId === clientId);
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
    const pendingEstimate = tasks.filter(t => t.status === 'pending_estimate').length;
    
    res.json({
        hours_left: (client.hours_package || 0) - (client.hours_used || 0),
        hours_used: client.hours_used || 0,
        hours_package: client.hours_package || 0,
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        in_progress_tasks: inProgressTasks,
        pending_estimate: pendingEstimate
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});
