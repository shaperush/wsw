const express = require('express');
const { Client, LocalAuth, MessageMedia, Location } = require('whatsapp-web.js');
const { Server } = require("socket.io");
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');
const fse = require('fs-extra');
const crypto = require('crypto');
const { sendNewMessagePush, setDeviceToken, removeDeviceToken } = require('./PushService')
const http = require('http');
const bodyParser = require('body-parser');
const app = express();
const port = 3000;
const server = http.createServer(app);
const path = require('path');
const sessions = new Map();
const socketList = new Map();
let store;
const filterType = ['emoji', 'chat', 'ptt','image', 'document', 'video', 'location', 'gif', 'vcard', 'sticker', /*'poll_creation',*/ 'audio', 'revoked'];
ffmpeg.setFfmpegPath(ffmpegStatic);

const io = new Server(server,{
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
})

app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send('<h1>Hello</h1>');
});

app.get('/getMedia', async (req, res) => {
    try { 
        const sessionId = req.query.sessionId;
        const messageId = req.query.messageId;
        const chatId = req.query.chatId;
 
        if (!sessionId || !messageId || !chatId) { throw new Error('Session not Found') }

        const client = sessions.get(sessionId);
        if (!client) { throw new Error('Client not Found') }

        const message = await _getMessageById(client, messageId, chatId)
        if (!message) { throw new Error('Message not Found') }

        const media = await message.downloadMedia();
        const id = message.id.id;
        const filetype = message.type;
        const imageUrl = message.mediaKey;
        var data = media.data;
        if (filetype === 'ptt') {
            convertBase64OggToBase64Mp3(media.data, (err, base64Mp3) => {
                if (err) { throw new Error('Error converting OGG to M4A:', err); }
                data = base64Mp3;
                const result = { id, chatId, filetype, data, imageUrl };
                res.send(JSON.stringify(result));
            });
        } else {
            const result = { id, chatId, filetype, data, imageUrl };
            res.send(JSON.stringify(result));
        }
    } catch (error) {
        console.log(error.message);
        res.send(JSON.stringify(error.message));
    }
});

server.listen(3000, () => {
    console.log('listening on *:3000');
});

const sendMessage = (socket, action, body) => {
    socket.emit(action, JSON.stringify(body));
}

const sendErrorResponse = (socket, status, message) => {
    socket.emit("error", JSON.stringify({ status, message }));
}

const _createWhatsappSession = async (clientId, socketGlobal) => {
    socketList.set(clientId, socketGlobal);
    if (sessions.has(clientId)) {
        const client = sessions.get(clientId);
        const state = await client.getState();
        console.log("AUTH WITH EXISTING SESSION", state)
        sendMessage(socketGlobal, 'authenticateStateResponse', { state });
    } else {
        try {
            const localAuth = new LocalAuth({ clientId: clientId })
            const client = new Client({
                puppeteer: {
                   /* executablePath: '/root/.cache/puppeteer/chrome',*/
                    args: ['--no-sandbox', '--disable-setuid-sandbox'],
                    headless: true
                },
                /*qrMaxRetries: 5,*/
                authStrategy: localAuth
            });

    
            sendMessage(socketList.get(clientId), 'authenticateStateResponse', { state: "LOADING" });

            client.on('loading_screen', (percent, message) => {
                console.log('LOADING SCREEN', percent, message);
            });

            client.on('change_state', (state) => {
                console.log('change_state', state);
            });
        
            client.on('auth_failure', msg => {
                console.error('AUTHENTICATION FAILURE', msg);
            });
        
            client.on('disconnected', async (session) => {
                console.log('DISCONNECTED: ', clientId, session);
                try {
                    const socket = socketList.get(clientId);
    
                    await deleteSession(clientId, true)
                    const state = "LOGOUT"

                    if (!socket) { throw new Error('socket error') }

                    sendMessage(socket, 'authenticateStateResponse', { state });
                } catch (error) {
                    sendErrorResponse(socket, 500, error.message)
                }
            });
    
            client.on("qr", (qr) => {
                console.log("QR RECEIVED", qr, clientId);
                try {
                    const socket = socketList.get(clientId);
                    if (!socket) { throw new Error('socket error') }

                    sendMessage(socket, 'qr', { qr });
                } catch (error) {
                    sendErrorResponse(socket, 500, error.message)
                }
            });

            client.on('remote_session_saved', async () => {
                console.log('SESSION SAVED: ', clientId);
                try {
                    const socket = socketList.get(clientId);
                    if (!socket) { throw new Error('remote_session_saved socket error') }
                    sendMessage(socket, 'saveSession', { clientId })
                } catch (error) {
                    sendErrorResponse(socket, 500, error.message)
                }
            });
        
            client.on('authenticated', async (session) => {
                console.log('AUTHENTICATED: ', clientId);
                try {
                    const socket = socketList.get(clientId);
                    if (!socket) { throw new Error('socket error') }

                    sendMessage(socket, 'authenticated', { clientId });
                } catch (error) {
                    sendErrorResponse(socket, 500, error.message)
                }
            });
        
            client.on('ready', async () => {
                console.log('READY: ', clientId);

                try {
                    const state = await client.getState();
                    const socket = socketList.get(clientId);
                    if (!socket) { throw new Error('socket error') }
                    sessions.set(clientId, client);
                    sendMessage(socket, 'ready', { state });
                } catch (error) {
                    sendErrorResponse(socket, 500, error.message)
                }
            });

            client.on('message', async (msg) => {
                console.log('MESSAGE RECEIVED: ', msg);
                try {
                    const message = msg._data?.body;
                    const chat = await client.getChatById(msg._data?.from);
                    if (!chat) { throw new Error('Chat not Found') }

                    sendNewMessagePush(clientId, message, chat.name);
                    _updateMessageList(msg, false, clientId);
            } catch (error) {
                sendErrorResponse(socket, 500, error.message)
            }
            });
        
            client.on('message_create', async (msg) => {
                console.log('MESSAGE CREATE', msg);
                _updateMessageList(msg, true, clientId);
            });
        
            client.on('message_revoke_everyone', async (msg) => {
                _revokeMessage(msg, clientId, false);
        
                console.log('message_revoke_everyone', msg);
            });
        
            client.on('message_revoke_me', async (msg) => {
                _revokeMessage(msg, clientId, true);
                console.log('message_revoke_me', msg);
            });

            client.on('message_ack', async (msg, messageAck) => {
                console.log('MESSAGE ACK', msg, messageAck);
                _updateMessageList(msg, true, clientId);
            });
        
            client.on('media_uploaded', async (msg) => {
                console.log('media_uploaded', msg, messageAck);
            });

            client.on('chat_archived', async (chat) => {
                try {
                    console.log('CHAT ARCHIVED');
                    const socket = socketList.get(clientId);
                    if (!socket) { throw new Error('socket error') }

                    let chatObject = _getChatObject(chat);
                    sendMessage(socket, 'updateChatListResponse',  [chatObject]);
                } catch (error) {
                    sendErrorResponse(socket, 500, error.message)
                }
            });
        
            client.initialize();
            // initializeEvents(client, clientId, socketGlobal);
            
        } catch {
            console.log('creating session error');
        }
    }
  };

io.on('connection', (socket) => {
    console.log('a user connected', socket?.id);

    socket.on('disconnect', () => {
        console.log('user disconnected', socket?.id);
        socketList.delete(socket?.id);
    });

    socket.on("connected",(data)=> {
        console.log("Connnected to the server",data)
        socket.emit(data);
    });

    socket.on('createSession', (data) => {
        const { sessionId } = data;
        console.log('createSession: socket: ', socket?.id, "clientId: ", sessionId);
        _createWhatsappSession(sessionId, socket)
    });

    socket.on('getAuthenticateState',async (data) => {
        try {
            const { sessionId } = data
            if (!checkAuthenticated(sessionId)) { throw new Error('Auth failed') }

            const client = sessions.get(sessionId);
            const state = await client.getState();
            sendMessage(socket, 'authenticateStateResponse', { state });
        } catch (error) {
            sendErrorResponse(socket, 500, error.message)
        }
    });

    socket.on('getChatListRequest', async (data) => {
        console.log("getChatListRequest")
        try {
            const { sessionId } = data
            if (!checkAuthenticated(sessionId)) { throw new Error('Auth failed') }
            const client = sessions.get(sessionId)

            const chats = await client.getChats();
            if (!chats) { throw new Error('Chats not Found') }

            let results = chats.map( chat => {
                return _getChatObject(chat);
            }).filter(item => item !== null);

            sendMessage(socket, 'getChatListResponse', results);

            let promises = chats.map(async (chat) => {
                const id = chat.id._serialized;
                const chatId = id;
                const filetype = "image";
                const contact = await chat.getContact();
                const imageUrl = await contact.getProfilePicUrl();
                return imageUrl ? { id, imageUrl, filetype, chatId  } : null;
            });
            const images = await Promise.all(promises);
            const filteredResults = images.filter(item => item !== null);

            sendMessage(socket, 'getChatImageListResponse', filteredResults);
        } catch (error) {
            sendErrorResponse(socket, 500, error.message)
        }
    });

    socket.on('getMessageListRequest',async (data) => {
        try {
            const { sessionId, chatId, limit } = data
            if (!checkAuthenticated(sessionId)) { throw new Error('Auth failed') }
            
            const client = sessions.get(sessionId)
            const chat = await client.getChatById(chatId);
            if (!chat) { throw new Error('Chat not Found') }
            await chat.sendSeen();

            const messageListData = await chat.fetchMessages({limit: limit});

            var messages = messageListData.map( (message) => {
                return _messageObject(message);
            });
            
            sendMessage(socket, 'getMessageListResponse',  messages);
        } catch (error) {
            console.log(error);
            sendErrorResponse(socket, 500, error.message)
        }
    });

    socket.on('seenMessageRequest',async (data) => {
        try {
            const { sessionId, chatId, limit } = data
            if (!checkAuthenticated(sessionId)) { throw new Error('Auth failed') }
            
            const client = sessions.get(sessionId)
            const chat = await client.getChatById(chatId);
            if (!chat) { throw new Error('Chat not Found') }
            await chat.sendSeen();
            
        } catch (error) {
            sendErrorResponse(socket, 500, error.message)
        }
    });

    socket.on('getMessageMediaListRequest',async (data) => {
        try {
            const { sessionId, chatId, mediaKeys } = data
            if (!checkAuthenticated(sessionId)) { throw new Error('Auth failed') }

            const client = sessions.get(sessionId)
            const chat = await client.getChatById(chatId);
            if (!chat) { throw new Error('Chat not Found') }

            const messageListData = await chat.fetchMessages({limit: 100});

            var messages = await Promise.all(messageListData.flatMap(async (message) => {
                return await _messageMediaObject(message, chatId, mediaKeys);
            }));
            messages = messages.filter(item => item !== null);
            sendMessage(socket, 'getMessageMediaListResponse',  messages);
        } catch (error) {
            sendErrorResponse(socket, 500, error.message)
        }
    });

    socket.on('getContactListRequest',async (data) => {
        try {
            const { sessionId } = data
           if (!checkAuthenticated(sessionId)) { throw new Error('Auth failed') }
            console.log("getContactListRequest")
            const client = sessions.get(sessionId);
            const contacts = await client.getContacts();
            if (!contacts) { throw new Error('Contact not Found') }

            var contactList = contacts.filter(item => item.id.server === 'c.us')
            .map( (contact) => {
                return _contactObject(contact);
            });

            sendMessage(socket, 'getContactListResponse',  contactList);

            let promises = contacts.map(async (contact) => {
                const id = contact.id._serialized;
                const chatId = id;
                const filetype = "image";
                const imageUrl = await contact.getProfilePicUrl();
                return imageUrl ? { id, imageUrl, filetype, chatId  } : null;
            });
            const images = await Promise.all(promises);
            const filteredResults = images.filter(item => item !== null);
            sendMessage(socket, 'getChatImageListResponse', filteredResults);
        } catch (error) {
            sendErrorResponse(socket, 500, error.message)
        }
    });

    socket.on('sendMessageRequest',async (data, ack) => {
        try {
            const { sessionId, chatId, content, contentType, temporaryId } = data;
            if (!checkAuthenticated(sessionId)) { throw new Error('Auth failed') }
            const client = sessions.get(sessionId);
            let messageOut;
            let options = { caption: temporaryId};
            switch (contentType) {
                case 'string':
                    messageOut = await client.sendMessage(chatId, content, options);
                    if (ack) {
                        ack(messageOut);
                    }
                        
                    break;
                case 'media': {
                    const oggBuffer = Buffer.from(content.data, 'base64');
                    const tempOggPath = `temp_${crypto.randomBytes(16).toString('hex')}.aac`;
                    const tempMp3Path = `temp_${crypto.randomBytes(16).toString('hex')}.mp3`;
                    fs.writeFileSync(tempOggPath, oggBuffer);
                    ffmpeg(tempOggPath)
                        .toFormat('mp3')
                        .audioBitrate('24k')
                        .on('end', async function() {
                            const messageMedia = MessageMedia.fromFilePath(tempMp3Path);
                            messageOut = await client.sendMessage(chatId, messageMedia, { sendAudioAsVoice: true, caption: temporaryId});
                            if (ack) {
                                ack(messageOut);
                            }
                            fs.unlinkSync(tempOggPath);
                            fs.unlinkSync(tempMp3Path);
                            
                        })
                        .on('error', function(err) {
                            console.log('An error occurred: ' + err.message);
                            fs.unlinkSync(tempOggPath);
                            fs.unlinkSync(tempMp3Path);
                            callback(err, null);
                        })
                        .save(tempMp3Path);
                    break
                }
                case 'location': {
                    const location = new Location(content.latitude, content.longitude, content.description);
                    messageOut = await client.sendMessage(chatId, location, options);
                    if (ack) {
                        ack(messageOut);
                    }
                    break;
                }
            } 
            
        } catch (error) {
            console.log('UserError:', error);
            sendErrorResponse(socket, 500, error.message)
        }
    });

    socket.on('sendReplyMessageRequest',async (data) => {
        try {
            const { sessionId, messageId, chatId, content, destinationChatId} = data
            if (!checkAuthenticated(sessionId)) { throw new Error('Auth failed') }

            var options = {};
            const client = sessions.get(sessionId);
            const message = await _getMessageById(client, messageId, chatId);
            if (!message) { throw new Error('Message not Found') }

            const repliedMessage = await message.reply(content, destinationChatId, options);
            sendMessage(socket, 'replyMessageResponse',  repliedMessage);
        } catch (error) {
            sendErrorResponse(socket, 500, error.message)
        }
    });

    //everyone: Bool
    socket.on('sendDeleteMessageRequest',async (data) => {
        try {
            const { sessionId, messageId, chatId, everyone } = data
            if (!checkAuthenticated(sessionId)) { throw new Error('Auth failed') }

            const client = sessions.get(sessionId);
            const message = await _getMessageById(client, messageId, chatId)
            if (!message) { throw new Error('Message not Found') }

            const result = await message.delete(everyone)
            sendMessage(socket, 'deleteMessageResponse',  result);
          } catch (error) {
            sendErrorResponse(socket, 500, error.message)
          }
    });

    socket.on('archiveChatRequest',async (data) => {
        try {
            console.log('archiveChatRequest');
            const { sessionId, chatId, isArchive } = data
            if (!checkAuthenticated(sessionId)) { throw new Error('Auth failed') }

            const client = sessions.get(sessionId);
            if (!client)  { throw new Error('Undefined client') }

            const chat = await client.getChatById(chatId);
            if (!chat) { throw new Error('Chat not Found') }

            if (isArchive) {
                await chat.archive();
            } else {
                await chat.unarchive();
            }
            
          } catch (error) {
            sendErrorResponse(socket, 500, error.message)
          }
    });

    socket.on('setToken',async (data) => {
        try {
            const { sessionId, deviceToken } = data;
            if (!checkAuthenticated(sessionId)) { throw new Error('Auth failed') }

            setDeviceToken(sessionId, deviceToken);
        } catch (error) {
            sendErrorResponse(socket, 500, error.message)
        }
    });



    socket.on('logoutRequest',async (data) => {
        try {
            console.log("LOGOUT REQUEST");
            const { sessionId } = data;
            if (!checkAuthenticated(sessionId)) { throw new Error('Auth failed') }
            await deleteSession(sessionId, false);
            
            sendMessage(socket, 'logoutResponse',  { sessionId: socket?.id });
        } catch (error) {
            console.log('ERRROR Logout', error);
            sendErrorResponse(socket, 500, error.message)
        }
    });


    const checkAuthenticated = (sessionId) => {
        if (!sessions.has(sessionId)) {
            sendMessage(socket, 'authenticateStateResponse', { state: "UNPAIRED" });
            return false
        }
        return true
    } 
}); 

const _revokeMessage = async (msg, clientId, forMe) => {
    try {
        const socket = socketList.get(clientId);
        if (!socket) { return }

        const client = sessions.get(clientId);
        if (!client)  { throw new Error('Client not Found') }

        const messageObject = _messageObject(msg);

        if (forMe) {
            sendMessage(socket, 'revokeMessageListResponse',  [messageObject]);
        } else {
            sendMessage(socket, 'updateMessageListResponse',  [messageObject]);
        }
    } catch (error) {
        const socket = socketList.get(clientId);
        sendErrorResponse(socket, 500, error.message)
    }
}

const _updateMessageList = async (msg, isTo, clientId) => {
    try {
        const socket = socketList.get(clientId);
        if (!socket) { return }

        const client = sessions.get(clientId);
        if (!client)  { throw new Error('Client not Found') }

        const messageObject = _messageObject(msg);
        sendMessage(socket, 'updateMessageListResponse',  [messageObject]);

        const chat = await client.getChatById(msg._data.id.remote);
        if (!chat) { throw new Error('Chat not Found') }
        
        const chatObject = _getChatObjectWithMessage(chat, messageObject, !msg._data.id.fromMe);
        sendMessage(socket, 'getChatListResponse', [chatObject]);

        if (messageObject.type === 'sticker') {
            const chatId = chat.id._serialized;
            const mediaMessage = await _messageMediaObject(msg, chatId, []);
            sendMessage(socket, 'getMessageMediaListResponse',  [mediaMessage]);
        }

    } catch (error) {
        const socket = socketList.get(clientId);
        sendErrorResponse(socket, 500, error.message)
    }
}

const _getMessageById = async (client, messageId, chatId) => {
    const chat = await client.getChatById(chatId)
    const messages = await chat.fetchMessages({ limit: 100 })
    const message = messages.find((message) => { return message.id.id === messageId })
    return message
}

const _messageObject = (message) => {
    var messageId = message.id.id;
    var type = message.type;
    var date = message.timestamp;
    var body = message._data?.body;
    var author = message.author;
    var duration = message.duration;
    var ack = message.ack;
    var mediaKey = message.mediaKey;
    var location = message.location;
    var from = message.from;
    var to = message.to;
    var fromMe = message.fromMe;
    var hasMedia = message.hasMedia;
    var hasQuotedMsg = message.hasQuotedMsg;
    var filename = message._data?.filename;
    var temporaryId = message._data?.caption;
    var quoted = null
    
    if (hasQuotedMsg) {
        var quoteData = message._data;
        var quoteType = quoteData.quotedMsg?.type; 
        var quoteId = quoteData.quotedStanzaID;
        var quoteAnthor = quoteData.quotedParticipant?._serialized ?? quoteData.quotedParticipant;
        var quoteBody =  quoteData.quotedMsg?.body;
        var quoteFilename = quoteData.quotedMsg?.filename
        var quoteDuration = quoteData.quotedMsg?.duration;
        var quoteMediaKey = quoteData.quotedMsg?.mediaKey;
        quoted = { quoteId, quoteAnthor, quoteBody, quoteDuration, quoteType, quoteFilename, quoteMediaKey };
    }
    if (!filterType.includes(type)) {
        body = type;
        type = 'system';
    }
    if (type === 'revoked') {
        const revokedMessageId = message._data?.protocolMessageKey?.id;
        if (revokedMessageId) {
            messageId = revokedMessageId
        }
    }
    
    const data = { messageId, filename, body, author, duration, type, ack, date, mediaKey, location, from, to, fromMe, hasMedia, quoted, hasQuotedMsg, temporaryId };
    return data;
}

const _messageMediaObject = async (message, chatId, mediaKeys) => {
    const isCached = !!mediaKeys.find((mediaKey) => { return message.mediaKey === mediaKey });
    if ((message.type == 'sticker')) {
        if (isCached) {
            const id = message.id.id;
            const filetype = message.type;
            const imageUrl = message.mediaKey;
            return { id, chatId, filetype, imageUrl };
        } else {
            const media = await message.downloadMedia();
            const id = message.id.id;
            const filetype = message.type;
            const data = media.data;
            const imageUrl = message.mediaKey;
            return { id, chatId, filetype, data, imageUrl };
        }
    } else {
        return null;
    }
};

const _getChatObject = (chat) => {
    if (!chat.lastMessage) {
        return null;
    }

    const chatId = chat.id._serialized;
    const name = chat.name;
    const date = chat.timestamp;
    const isArchived = chat.archived ?? false;
    const isGroup = chat.isGroup;
    const unreadCount = chat.unreadCount;
    const lastMessage = _messageObject(chat.lastMessage);
    const chatData = { chatId, name, date, isArchived, isGroup, unreadCount, lastMessage };
    return chatData;
};

const _getChatObjectWithMessage = (chat, message, isNewReceive) => {
    const chatId = chat.id._serialized;
    const name = chat.name;
    const date = message.date;
    const isArchived = chat.archived ?? false;
    const isGroup = chat.isGroup;
    const unreadCount = isNewReceive ? chat.unreadCount + 1 : chat.unreadCount;
    const lastMessage = message;
    const chatData = { chatId, name, date, isArchived, isGroup, unreadCount, lastMessage };
    return chatData;
};

const _contactObject = (contact) => {
    const contactId = contact.id._serialized;
    const name = contact.name;
    const shortName = contact.shortName;
    const phoneNumber = contact.phoneNumber;
    const type = contact.type;
    const isUser = contact.isUser;
    const isGroup = contact.isGroup;
    const isWAContact = contact.isWAContact;
    const isBlocked = contact.isBlocked;
    const contactData = { contactId, name, shortName, phoneNumber, type, isUser, isGroup, isWAContact, isBlocked };
    return contactData;
};

function convertBase64OggToBase64Mp3(base64Ogg, callback) {
    const oggBuffer = Buffer.from(base64Ogg, 'base64');
    const tempOggPath = `temp_${crypto.randomBytes(16).toString('hex')}.ogg`;
    const tempMp3Path = `temp_${crypto.randomBytes(16).toString('hex')}.mp3`;
    fs.writeFileSync(tempOggPath, oggBuffer);
    ffmpeg(tempOggPath)
        .toFormat('mp3')
        .audioBitrate('24k')
        .on('end', function() {
            const mp3Buffer = fs.readFileSync(tempMp3Path);
            const base64Mp3 = mp3Buffer.toString('base64');
            fs.unlinkSync(tempOggPath);
            fs.unlinkSync(tempMp3Path);
            callback(null, base64Mp3);
        })
        .on('error', function(err) {
            console.log('An error occurred: ' + err.message);
            fs.unlinkSync(tempOggPath);
            fs.unlinkSync(tempMp3Path);
            callback(err, null);
        })
        .save(tempMp3Path);
}

const deleteSession = async (sessionId, onlyDestroy) => {
    try {
        const client = sessions.get(sessionId)
        if (!client) {  throw new Error('Undefined session id')}
        client.pupPage.removeAllListeners('close');
        client.pupPage.removeAllListeners('error');

        if (onlyDestroy) {
            await client.destroy();
        } else {
            await client.logout();
        }

        while (client.pupBrowser.isConnected()) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        sessions.delete(sessionId);
        socketList.delete(sessionId);
        removeDeviceToken(sessionId);
    } catch (error) {
      console.log(error)
      throw error
    }
}