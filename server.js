const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    // Простой HTTP сервер для файлов
    if (req.url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, req.url);
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(200);
                res.end(data);
            }
        });
    }
});

const wss = new WebSocket.Server({ server });

// Хранилища данных
const users = new Map(); // socket -> пользователь
const userNames = new Set();
const rooms = new Set(['general']);
const userProfiles = new Map(); // userId -> профиль
const messages = new Map(); // room -> [сообщения]
const reactions = new Map(); // messageId -> реакции
const polls = new Map(); // pollId -> опрос

const PORT = process.env.PORT || 9999;

// Цвета для аватарок
const AVATAR_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD',
    '#D4A5A5', '#9B59B6', '#3498DB', '#E67E22', '#2ECC71',
    '#E74C3C', '#1ABC9C', '#F1C40F', '#E67E22', '#E84342'
];

// Смайлики для реакций
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉'];

wss.on('connection', (ws) => {
    console.log('Новое подключение');
    let currentUser = null;

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            switch(message.type) {
                case 'login':
                    handleLogin(ws, message);
                    break;
                case 'message':
                    handleMessage(ws, message);
                    break;
                case 'private_message':
                    handlePrivateMessage(ws, message);
                    break;
                case 'create_room':
                    handleCreateRoom(ws, message);
                    break;
                case 'join_room':
                    handleJoinRoom(ws, message);
                    break;
                case 'update_profile':
                    handleUpdateProfile(ws, message);
                    break;
                case 'set_status':
                    handleSetStatus(ws, message);
                    break;
                case 'upload_file':
                    handleFileUpload(ws, message);
                    break;
                case 'add_reaction':
                    handleAddReaction(ws, message);
                    break;
                case 'create_poll':
                    handleCreatePoll(ws, message);
                    break;
                case 'vote_poll':
                    handleVotePoll(ws, message);
                    break;
                case 'pin_message':
                    handlePinMessage(ws, message);
                    break;
                case 'delete_message':
                    handleDeleteMessage(ws, message);
                    break;
                case 'search_messages':
                    handleSearchMessages(ws, message);
                    break;
                case 'typing':
                    handleTyping(ws, message);
                    break;
                case 'command':
                    handleCommand(ws, message);
                    break;
            }
        } catch (error) {
            console.error('Ошибка:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Ошибка обработки сообщения'
            }));
        }
    });

    ws.on('close', () => {
        if (currentUser) {
            console.log(`${currentUser.name} отключился`);
            currentUser.status = 'offline';
            users.delete(ws);
            userNames.delete(currentUser.name);
            
            // Обновляем статус для всех
            broadcastToAll({
                type: 'user_status',
                userId: currentUser.id,
                status: 'offline'
            });
            
            sendUserList();
        }
    });

    function handleLogin(ws, message) {
        const { name, avatarColor } = message;
        
        if (!name || userNames.has(name)) {
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: 'Имя уже занято или некорректно' 
            }));
            return;
        }
        
        const userId = Date.now().toString();
        const color = avatarColor || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
        
        currentUser = { 
            id: userId, 
            name: name, 
            room: 'general',
            status: 'online',
            avatarColor: color,
            bio: '',
            registered: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            isAdmin: false
        };
        
        users.set(ws, currentUser);
        userNames.add(name);
        
        // Сохраняем профиль
        userProfiles.set(userId, currentUser);
        
        // Добавляем в общую комнату
        if (!rooms.has('general')) {
            rooms.add('general');
        }
        
        // Приветственное сообщение
        ws.send(JSON.stringify({
            type: 'login_success',
            user: currentUser,
            message: '👋 Добро пожаловать!'
        }));
        
        // Отправляем список комнат
        ws.send(JSON.stringify({
            type: 'room_list',
            rooms: Array.from(rooms)
        }));
        
        // Отправляем историю сообщений
        if (messages.has('general')) {
            ws.send(JSON.stringify({
                type: 'message_history',
                messages: messages.get('general')
            }));
        }
        
        // Отправляем список пользователей
        sendUserList();
        
        // Системное сообщение о входе
        broadcastToRoom('general', {
            type: 'system',
            content: `🎉 ${currentUser.name} присоединился к чату!`,
            user: { id: userId, name: currentUser.name }
        }, 'general');
        
        console.log(`${name} вошел в чат`);
    }

    function handleMessage(ws, message) {
        if (!currentUser) return;

        const { content, room = 'general' } = message;
        
        if (!content || !content.trim()) return;
        
        // Проверка на команды
        if (content.startsWith('/')) {
            handleCommand(ws, { command: content.slice(1) });
            return;
        }
        
        const msg = {
            id: Date.now().toString() + Math.random(),
            type: 'message',
            userId: currentUser.id,
            userName: currentUser.name,
            userAvatar: currentUser.avatarColor,
            content: content,
            time: new Date().toLocaleTimeString(),
            date: new Date().toISOString(),
            room: room,
            reactions: [],
            pinned: false,
            edited: false
        };
        
        // Сохраняем сообщение
        if (!messages.has(room)) {
            messages.set(room, []);
        }
        messages.get(room).push(msg);
        
        // Ограничиваем историю
        if (messages.get(room).length > 100) {
            messages.get(room).shift();
        }
        
        // Отправляем всем в комнате
        broadcastToRoom(room, msg, room);
        
        // Проверяем упоминания
        const mentions = content.match(/@(\w+)/g);
        if (mentions) {
            mentions.forEach(mention => {
                const mentionedName = mention.slice(1);
                users.forEach((user, socket) => {
                    if (user.name === mentionedName && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({
                            type: 'mention',
                            from: currentUser.name,
                            message: content,
                            room: room
                        }));
                    }
                });
            });
        }
    }

    function handlePrivateMessage(ws, message) {
        if (!currentUser) return;

        const { toUserId, content } = message;
        
        if (!toUserId || !content) return;

        let targetSocket = null;
        let targetUser = null;
        
        for (let [socket, user] of users.entries()) {
            if (user.id === toUserId) {
                targetSocket = socket;
                targetUser = user;
                break;
            }
        }
        
        if (!targetSocket) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Пользователь не в сети'
            }));
            return;
        }
        
        const privateMsg = {
            id: Date.now().toString() + Math.random(),
            type: 'private_message',
            fromUserId: currentUser.id,
            fromUserName: currentUser.name,
            toUserId: toUserId,
            toUserName: targetUser.name,
            content: content,
            time: new Date().toLocaleTimeString(),
            read: false
        };
        
        ws.send(JSON.stringify(privateMsg));
        targetSocket.send(JSON.stringify(privateMsg));
        
        // Уведомление о непрочитанном
        if (!targetUser.unreadMessages) {
            targetUser.unreadMessages = {};
        }
        if (!targetUser.unreadMessages[currentUser.id]) {
            targetUser.unreadMessages[currentUser.id] = 0;
        }
        targetUser.unreadMessages[currentUser.id]++;
    }

    function handleCreateRoom(ws, message) {
        if (!currentUser) return;

        let { roomName } = message;
        
        if (!roomName || roomName.trim() === '') return;
        roomName = roomName.trim();

        if (rooms.has(roomName)) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Комната уже существует'
            }));
            return;
        }

        rooms.add(roomName);
        
        broadcastToAll({
            type: 'new_room',
            room: roomName,
            createdBy: currentUser.name
        });
        
        ws.send(JSON.stringify({
            type: 'notification',
            message: `✅ Комната "${roomName}" создана!`
        }));
    }

    function handleJoinRoom(ws, message) {
        if (!currentUser) return;

        const { roomName } = message;
        
        if (!rooms.has(roomName)) return;
        
        const oldRoom = currentUser.room;
        currentUser.room = roomName;
        
        ws.send(JSON.stringify({
            type: 'room_changed',
            room: roomName
        }));
        
        // Отправляем историю сообщений комнаты
        if (messages.has(roomName)) {
            ws.send(JSON.stringify({
                type: 'message_history',
                messages: messages.get(roomName)
            }));
        }
        
        // Уведомление о входе/выходе
        if (oldRoom !== roomName) {
            broadcastToRoom(roomName, {
                type: 'system',
                content: `🚶 ${currentUser.name} присоединился к комнате`
            }, roomName);
            
            broadcastToRoom(oldRoom, {
                type: 'system',
                content: `🚶 ${currentUser.name} покинул комнату`
            }, oldRoom);
        }
        
        sendUserList();
    }

    function handleUpdateProfile(ws, message) {
        if (!currentUser) return;

        const { bio, avatarColor } = message;
        
        if (bio !== undefined) currentUser.bio = bio;
        if (avatarColor !== undefined) currentUser.avatarColor = avatarColor;
        
        userProfiles.set(currentUser.id, currentUser);
        
        broadcastToAll({
            type: 'profile_updated',
            userId: currentUser.id,
            bio: currentUser.bio,
            avatarColor: currentUser.avatarColor
        });
        
        ws.send(JSON.stringify({
            type: 'notification',
            message: '✅ Профиль обновлен'
        }));
    }

    function handleSetStatus(ws, message) {
        if (!currentUser) return;

        const { status } = message;
        
        if (['online', 'away', 'busy', 'offline'].includes(status)) {
            currentUser.status = status;
            currentUser.lastSeen = new Date().toISOString();
            
            broadcastToAll({
                type: 'user_status',
                userId: currentUser.id,
                status: status,
                lastSeen: currentUser.lastSeen
            });
        }
    }

    function handleFileUpload(ws, message) {
        if (!currentUser) return;

        const { fileName, fileData, fileType, room } = message;
        
        const fileId = Date.now().toString() + Math.random();
        const fileExt = path.extname(fileName);
        const safeFileName = fileId + fileExt;
        const filePath = path.join(__dirname, 'uploads', safeFileName);
        
        // Создаем папку uploads если её нет
        if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
            fs.mkdirSync(path.join(__dirname, 'uploads'));
        }
        
        // Сохраняем файл
        const buffer = Buffer.from(fileData, 'base64');
        fs.writeFile(filePath, buffer, (err) => {
            if (err) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Ошибка сохранения файла'
                }));
                return;
            }
            
            const fileMsg = {
                id: fileId,
                type: 'file',
                userId: currentUser.id,
                userName: currentUser.name,
                fileName: fileName,
                fileType: fileType,
                fileSize: buffer.length,
                fileUrl: `/uploads/${safeFileName}`,
                time: new Date().toLocaleTimeString(),
                room: room || currentUser.room
            };
            
            broadcastToRoom(room || currentUser.room, fileMsg, room || currentUser.room);
        });
    }

    function handleAddReaction(ws, message) {
        if (!currentUser) return;

        const { messageId, reaction, room } = message;
        
        if (!reactions.has(messageId)) {
            reactions.set(messageId, new Map());
        }
        
        const messageReactions = reactions.get(messageId);
        
        if (!messageReactions.has(reaction)) {
            messageReactions.set(reaction, new Set());
        }
        
        const usersReacted = messageReactions.get(reaction);
        
        if (usersReacted.has(currentUser.id)) {
            usersReacted.delete(currentUser.id);
        } else {
            usersReacted.add(currentUser.id);
        }
        
        broadcastToRoom(room, {
            type: 'reaction_update',
            messageId: messageId,
            reactions: Array.from(messageReactions.entries()).map(([r, users]) => ({
                reaction: r,
                count: users.size,
                users: Array.from(users)
            }))
        }, room);
    }

    function handleCreatePoll(ws, message) {
        if (!currentUser) return;

        const { question, options, room } = message;
        
        const pollId = Date.now().toString();
        const poll = {
            id: pollId,
            question: question,
            options: options.map(opt => ({ text: opt, votes: 0 })),
            createdBy: currentUser.id,
            createdByName: currentUser.name,
            voters: new Set(),
            room: room
        };
        
        polls.set(pollId, poll);
        
        broadcastToRoom(room, {
            type: 'new_poll',
            poll: {
                id: pollId,
                question: question,
                options: options.map(opt => ({ text: opt, votes: 0 })),
                createdByName: currentUser.name
            }
        }, room);
    }

    function handleVotePoll(ws, message) {
        if (!currentUser) return;

        const { pollId, optionIndex } = message;
        
        const poll = polls.get(pollId);
        if (!poll) return;
        
        if (poll.voters.has(currentUser.id)) return;
        
        poll.voters.add(currentUser.id);
        poll.options[optionIndex].votes++;
        
        broadcastToRoom(poll.room, {
            type: 'poll_update',
            pollId: pollId,
            options: poll.options
        }, poll.room);
    }

    function handlePinMessage(ws, message) {
        if (!currentUser) return;

        const { messageId, room, pin } = message;
        
        const roomMessages = messages.get(room);
        if (!roomMessages) return;
        
        const msg = roomMessages.find(m => m.id === messageId);
        if (msg) {
            msg.pinned = pin;
            
            broadcastToRoom(room, {
                type: 'message_pinned',
                messageId: messageId,
                pinned: pin,
                room: room
            }, room);
        }
    }

    function handleDeleteMessage(ws, message) {
        if (!currentUser) return;

        const { messageId, room, forEveryone } = message;
        
        const roomMessages = messages.get(room);
        if (!roomMessages) return;
        
        const index = roomMessages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            const msg = roomMessages[index];
            
            // Проверяем права (своё сообщение или админ)
            if (msg.userId === currentUser.id || currentUser.isAdmin) {
                if (forEveryone) {
                    roomMessages.splice(index, 1);
                    broadcastToRoom(room, {
                        type: 'message_deleted',
                        messageId: messageId,
                        room: room
                    }, room);
                } else {
                    ws.send(JSON.stringify({
                        type: 'delete_for_me',
                        messageId: messageId
                    }));
                }
            }
        }
    }

    function handleSearchMessages(ws, message) {
        if (!currentUser) return;

        const { query, room } = message;
        
        const roomMessages = messages.get(room) || [];
        const results = roomMessages.filter(msg => 
            msg.content && msg.content.toLowerCase().includes(query.toLowerCase())
        );
        
        ws.send(JSON.stringify({
            type: 'search_results',
            query: query,
            results: results
        }));
    }

    function handleTyping(ws, message) {
        if (!currentUser) return;

        const { room, isTyping } = message;
        
        broadcastToRoom(room, {
            type: 'typing_indicator',
            userId: currentUser.id,
            userName: currentUser.name,
            isTyping: isTyping
        }, room);
    }

    function handleCommand(ws, message) {
        if (!currentUser) return;

        const { command } = message;
        const parts = command.split(' ');
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);
        
        let response = '';
        
        switch(cmd) {
            case 'help':
                response = `📋 Доступные команды:
/help - показать помощь
/time - показать текущее время
/date - показать дату
/users - список пользователей
/clear - очистить чат (только для вас)
/bio [текст] - установить био
/status [online/away/busy] - установить статус
/roll [макс] - случайное число
/weather [город] - погода (демо)
/ joke - случайная шутка
/quote - случайная цитата`;
                break;
                
            case 'time':
                response = `🕐 Текущее время: ${new Date().toLocaleTimeString()}`;
                break;
                
            case 'date':
                response = `📅 Сегодня: ${new Date().toLocaleDateString()}`;
                break;
                
            case 'users':
                const onlineUsers = Array.from(users.values())
                    .map(u => `${u.name} (${u.status})`)
                    .join(', ');
                response = `👥 Пользователи онлайн: ${onlineUsers}`;
                break;
                
            case 'clear':
                ws.send(JSON.stringify({
                    type: 'clear_chat'
                }));
                return;
                
            case 'bio':
                if (args.length) {
                    currentUser.bio = args.join(' ');
                    response = `✅ Био обновлено: ${currentUser.bio}`;
                } else {
                    response = `📝 Ваше био: ${currentUser.bio || 'не указано'}`;
                }
                break;
                
            case 'status':
                if (args.length && ['online', 'away', 'busy'].includes(args[0])) {
                    currentUser.status = args[0];
                    response = `✅ Статус изменен на: ${args[0]}`;
                    
                    broadcastToAll({
                        type: 'user_status',
                        userId: currentUser.id,
                        status: currentUser.status
                    });
                } else {
                    response = `📊 Ваш статус: ${currentUser.status}`;
                }
                break;
                
            case 'roll':
                const max = parseInt(args[0]) || 100;
                const roll = Math.floor(Math.random() * max) + 1;
                response = `🎲 Вы бросили кубик и получили: ${roll}`;
                break;
                
            case 'joke':
                const jokes = [
                    'Почему программисты путают Хэллоуин и Рождество? Потому что Oct 31 = Dec 25!',
                    'Что говорит один байт другому? "Ты бит?"',
                    'Как программисты моют посуду? Оставляют её в раковине на ночь — утром сама отмокнет!',
                    'В чем разница между программистом и политиком? Программисту платят за работающие программы!'
                ];
                response = jokes[Math.floor(Math.random() * jokes.length)];
                break;
                
            case 'quote':
                const quotes = [
                    'Лучший способ предсказать будущее — создать его. — Авраам Линкольн',
                    'Программирование — это не просто наука, это искусство. — Неизвестный',
                    'Будь тем изменением, которое хочешь увидеть в мире. — Махатма Ганди'
                ];
                response = quotes[Math.floor(Math.random() * quotes.length)];
                break;
                
            case 'weather':
                const city = args.join(' ') || 'Москва';
                const temps = [-5, 0, 5, 10, 15, 20, 25];
                const conditions = ['солнечно', 'облачно', 'дождливо', 'снежно', 'ветрено'];
                response = `🌤 Погода в ${city}: ${temps[Math.floor(Math.random() * temps.length)]}°C, ${conditions[Math.floor(Math.random() * conditions.length)]}`;
                break;
                
            default:
                response = `❌ Неизвестная команда. Введите /help для списка команд.`;
        }
        
        if (response) {
            ws.send(JSON.stringify({
                type: 'system',
                content: response
            }));
        }
    }

    function sendUserList() {
        const userList = Array.from(users.values()).map(u => ({
            id: u.id,
            name: u.name,
            status: u.status,
            avatarColor: u.avatarColor,
            bio: u.bio,
            room: u.room,
            lastSeen: u.lastSeen
        }));
        
        broadcastToAll({
            type: 'user_list',
            users: userList
        });
    }

    function broadcastToRoom(room, message, excludeRoom = null) {
        const messageStr = JSON.stringify(message);
        users.forEach((user, socket) => {
            if (user.room === room && socket.readyState === WebSocket.OPEN) {
                socket.send(messageStr);
            }
        });
    }

    function broadcastToAll(message) {
        const messageStr = JSON.stringify(message);
        wss.clients.forEach(socket => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(messageStr);
            }
        });
    }
});

// Создаем папку для загрузок
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'));
}

server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ULTRA MESSENGER ЗАПУЩЕН!');
    console.log(`📱 Порт: ${PORT}`);
    console.log('✨ Функции:');
    console.log('   ✅ Профили с аватарками');
    console.log('   ✅ Статусы (онлайн/отошел/занят)');
    console.log('   ✅ Био и дата регистрации');
    console.log('   ✅ Команды (/help)');
    console.log('   ✅ Упоминания через @');
    console.log('   ✅ Реакции на сообщения');
    console.log('   ✅ Закрепленные сообщения');
    console.log('   ✅ Поиск по сообщениям');
    console.log('   ✅ Загрузка файлов');
    console.log('   ✅ Опросы');
    console.log('   ✅ И многое другое!');
});