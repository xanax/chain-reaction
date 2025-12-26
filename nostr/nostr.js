class NostrClient {
    constructor() {
        this.relays = [
            'wss://relay.damus.io',
            'wss://nos.lol',
            'wss://relay.nostr.band'
        ];
        this.connections = new Map();
        this.subscriptions = new Map();
        this.connect();
    }

    async connect() {
        for (const relay of this.relays) {
            try {
                const ws = new WebSocket(relay);
                
                ws.onopen = () => {
                    console.log(`Connected to ${relay}`);
                    this.connections.set(relay, ws);
                };
                
                ws.onmessage = (event) => {
                    this.handleMessage(JSON.parse(event.data));
                };
                
                ws.onerror = (error) => {
                    console.error(`Error with ${relay}:`, error);
                };
                
                ws.onclose = () => {
                    console.log(`Disconnected from ${relay}`);
                    this.connections.delete(relay);
                };
                
            } catch (error) {
                console.error(`Failed to connect to ${relay}:`, error);
            }
        }
    }

    handleMessage(message) {
        const [type, subId, event] = message;
        
        if (type === 'EVENT' && this.subscriptions.has(subId)) {
            console.log(`Received event for ${subId}:`, event.content);
            const callback = this.subscriptions.get(subId);
            callback(event);
        } else if (type === 'EOSE') {
            console.log(`End of stored events for ${subId}`);
        }
    }

    async publish(gameCode, eventType, data) {
        if (typeof window.NostrTools === 'undefined') {
            console.log(`Mock: Publishing ${eventType} to game ${gameCode}:`, data);
            return;
        }

        const event = {
            kind: 1,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['t', `game-${gameCode}`],
                ['type', eventType],
                ['game', gameCode]
            ],
            content: JSON.stringify(data)
        };

        try {
            const signedEvent = window.NostrTools.finalizeEvent(event, window.identity.privkey);
            const message = ['EVENT', signedEvent];
            
            let published = 0;
            this.connections.forEach((ws, relay) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(message));
                    published++;
                }
            });
            console.log(`Published ${eventType} to ${published} relays`);
        } catch (error) {
            console.log('Publish error:', error);
        }
    }

    subscribe(gameCode, callback, since = null) {
        const subId = `game-${gameCode}-${Date.now()}`;
        this.subscriptions.set(subId, callback);

        const filter = {
            kinds: [1],
            '#t': [`game-${gameCode}`],
            limit: 100
        };

        if (since) {
            filter.since = since;
        }

        const message = ['REQ', subId, filter];
        
        this.connections.forEach((ws, relay) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
                console.log(`Subscribed to ${gameCode} on ${relay}`);
            }
        });
    }

    async getHistory(gameCode) {
        return new Promise((resolve) => {
            const events = [];
            const subId = `history-${gameCode}-${Date.now()}`;
            
            const timeout = setTimeout(() => {
                this.unsubscribe(subId);
                console.log(`Got ${events.length} history events for ${gameCode}`);
                resolve(events.sort((a, b) => a.created_at - b.created_at));
            }, 2000);

            this.subscriptions.set(subId, (event) => {
                if (event.tags.find(tag => tag[0] === 'game' && tag[1] === gameCode)) {
                    events.push(event);
                }
            });

            const filter = {
                kinds: [1],
                '#t': [`game-${gameCode}`],
                limit: 1000
            };

            const message = ['REQ', subId, filter];
            
            this.connections.forEach((ws, relay) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(message));
                }
            });
        });
    }

    unsubscribe(subId) {
        this.subscriptions.delete(subId);
        const message = ['CLOSE', subId];
        
        this.connections.forEach((ws, relay) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        });
    }
}