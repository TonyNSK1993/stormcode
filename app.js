const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ПУТЬ К БАЗЕ В КОРНЕ ПРОЕКТА
const DB_PATH = path.join(__dirname, 'db.json');

// Функции для работы с БД
function readDB() {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Ошибка чтения db.json:', error);
        return { users: {}, projects: [], tasks: [], messages: [], transactions: [] };
    }
}

function writeDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ============= АВТОРИЗАЦИЯ =============
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

// ============= ПОЛЬЗОВАТЕЛИ =============
app.get('/api/users', (req, res) => {
    const db = readDB();
    const clients = Object.values(db.users).filter(u => u.role === 'client');
    res.json(clients);
});

app.get('/api/user/:id', (req, res) => {
    const db = readDB();
    const user = db.users[req.params.id];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password, ...safeUser } = user;
    res.json(safeUser);
});

// ============= ПРОЕКТЫ =============
app.get('/api/projects', (req, res) => {
    const { clientId } = req.query;
    const db = readDB();
    let projects = db.projects;
    if (clientId) projects = projects.filter(p => p.clientId === clientId);
    res.json(projects);
});

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

app.put('/api/projects/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const db = readDB();
    const index = db.projects.findIndex(p => p.id === id);
    if (index === -1) return res.status(404).json({ error: 'Project not found' });
    db.projects[index] = { ...db.projects[index], ...updates };
    writeDB(db);
    res.json(db.projects[index]);
});

// ============= ЗАДАЧИ =============
app.get('/api/tasks', (req, res) => {
    const { clientId, projectId, status } = req.query;
    const db = readDB();
    let tasks = db.tasks;
    if (clientId) tasks = tasks.filter(t => t.clientId === clientId);
    if (projectId) tasks = tasks.filter(t => t.projectId === projectId);
    if (status) tasks = tasks.filter(t => t.status === status);
    res.json(tasks);
});

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

app.put('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const db = readDB();
    const index = db.tasks.findIndex(t => t.id === id);
    if (index === -1) return res.status(404).json({ error: 'Task not found' });
    
    db.tasks[index] = { ...db.tasks[index], ...updates, updatedAt: new Date().toISOString() };
    writeDB(db);
    res.json(db.tasks[index]);
});

app.post('/api/tasks/:id/spend', (req, res) => {
    const { id } = req.params;
    const { hours } = req.body;
    const db = readDB();
    const taskIndex = db.tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) return res.status(404).json({ error: 'Task not found' });
    
    db.tasks[taskIndex].spent_hours = (db.tasks[taskIndex].spent_hours || 0) + hours;
    
    // Списать часы из пакета клиента
    const client = db.users[db.tasks[taskIndex].clientId];
    if (client) {
        client.hours_used = (client.hours_used || 0) + hours;
    }
    
    if (db.tasks[taskIndex].spent_hours >= db.tasks[taskIndex].approved_hours) {
        db.tasks[taskIndex].status = 'completed';
    }
    
    writeDB(db);
    res.json({ task: db.tasks[taskIndex], client });
});

// ============= СООБЩЕНИЯ (ЧАТ) =============
app.get('/api/messages', (req, res) => {
    const { projectId, userId } = req.query;
    const db = readDB();
    let messages = db.messages;
    if (projectId) messages = messages.filter(m => m.projectId === projectId);
    if (userId) messages = messages.filter(m => m.from === userId || m.to === userId);
    res.json(messages);
});

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

app.put('/api/messages/mark-read', (req, res) => {
    const { userId } = req.body;
    const db = readDB();
    db.messages.forEach(msg => {
        if (msg.to === userId && !msg.read) msg.read = true;
    });
    writeDB(db);
    res.json({ success: true });
});

// ============= ПАКЕТЫ ЧАСОВ =============
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
    res.json({ success: true, hours_package: client.hours_package, hours_used: client.hours_used || 0 });
});

// ============= СТАТИСТИКА КЛИЕНТА =============
app.get('/api/client-stats/:clientId', (req, res) => {
    const { clientId } = req.params;
    const db = readDB();
    const client = db.users[clientId];
    if (!client) return res.status(404).json({ error: 'Client not found' });
    
    const tasks = db.tasks.filter(t => t.clientId === clientId);
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
    const pendingEstimate = tasks.filter(t => t.status === 'pending_estimate').length;
    const waitingApproval = tasks.filter(t => t.status === 'waiting_approval').length;
    
    res.json({
        hours_left: (client.hours_package || 0) - (client.hours_used || 0),
        hours_used: client.hours_used || 0,
        hours_package: client.hours_package || 0,
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        in_progress_tasks: inProgressTasks,
        pending_estimate: pendingEstimate,
        waiting_approval: waitingApproval
    });
});

// ============= АДМИНСКАЯ СТАТИСТИКА =============
app.get('/api/admin-stats', (req, res) => {
    const db = readDB();
    const clients = Object.values(db.users).filter(u => u.role === 'client');
    const tasks = db.tasks;
    const totalHoursPackage = clients.reduce((sum, c) => sum + (c.hours_package || 0), 0);
    const totalHoursUsed = clients.reduce((sum, c) => sum + (c.hours_used || 0), 0);
    
    res.json({
        total_clients: clients.length,
        total_tasks: tasks.length,
        pending_tasks: tasks.filter(t => t.status === 'pending_estimate').length,
        in_progress_tasks: tasks.filter(t => t.status === 'in_progress').length,
        total_hours_sold: totalHoursPackage,
        total_hours_used: totalHoursUsed,
        total_revenue: totalHoursPackage * 1100
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log('📁 База данных: db.json (в корне проекта)');
    console.log('\n🔑 Тестовые входы:');
    console.log('   Админ: innet.24@internet.ru / admin123');
    console.log('   Клиент: client@example.com / client123\n');
});
