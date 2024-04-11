const PushNotifications = require('node-pushnotifications');
const topic = 'com.bestdevs.development.watchkitapp';
const settings = {
    apn: {
        token: {
            key: './app/cert/AuthKey_4QS5DPT92S.p8', 
            keyId: '4QS5DPT92S',
            teamId: 'QY5934K5B6',
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
        console.log("SEND PUSH START")
        if (!deviceToken) { throw new Error('Undefined registration id'); }
        console.log("SEND PUSH END")
        const data = { alert: { title: chatName, body: message },
                        topic: topic,
                        expiry: 0,
                        pushType: 'alert',
                        priority: 10
        };


        push.send(deviceToken, data, (err, result) => {
            if (err) { 
                console.log('Error send push', err);
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

