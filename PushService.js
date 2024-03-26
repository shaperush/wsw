const PushNotifications = require('node-pushnotifications');
const topic = 'app.user.WhatsappWhatch.watchkitapp';
const settings = {
    apn: {
        token: {
            key: './cert/AuthKey_MJ9F6ZBCVH.p8', 
            keyId: 'MJ9F6ZBCVH',
            teamId: 'RL8RZDCK3Q',
        },
        production: false
    },
    isAlwaysUseFCM: false
};
const push = new PushNotifications(settings);
const registationIds = new Map();

const sendNewMessagePush = (clientId, message, chatName) => {
    try {
        const deviceToken = registationIds.get(clientId);
        if (!deviceToken) { throw new Error('Undefined registration id'); }
        const data = { alert: { title: chatName, subtitle: message },
                        topic: topic,
                        expiry: 0,
                        pushType: 'alert',
                        priority: 10
        };


        push.send(deviceToken, data, (err, result) => {
            if (err) { 
                throw new Error('Message not Found') 
            } 
        });
    } catch (error) {
        console.log('Error send push', error);
    }
};

const setDeviceToken = (clientId, deviceToken) => {
    console.log('SET NEW TOKEN', clientId, deviceToken);
    registationIds.set(clientId, deviceToken);
};

const removeDeviceToken = (clientId) => {
    registationIds.delete(clientId);
}

module.exports = {
    sendNewMessagePush,
    setDeviceToken,
    removeDeviceToken
}

