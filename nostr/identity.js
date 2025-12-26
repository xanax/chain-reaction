class Identity {
    constructor() {
        this.privkey = null;
        this.pubkey = null;
    }

    generateNew() {
        if (typeof window.NostrTools !== 'undefined') {
            try {
                this.privkey = window.NostrTools.generateSecretKey();
                this.pubkey = window.NostrTools.getPublicKey(this.privkey);
            } catch (error) {
                this.privkey = this.generateSimpleKey();
                this.pubkey = this.generateSimpleKey();
            }
        } else {
            this.privkey = this.generateSimpleKey();
            this.pubkey = this.generateSimpleKey();
        }
        this.saveToStorage();
        const pubkeyDisplay = typeof this.pubkey === 'string' ? this.pubkey : Array.from(this.pubkey).map(b => b.toString(16).padStart(2, '0')).join('');
        console.log('Generated new identity:', pubkeyDisplay.slice(0, 8) + '...');
    }

    generateSimpleKey() {
        const chars = '0123456789abcdef';
        let result = '';
        for (let i = 0; i < 64; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }

    saveToStorage() {
        let privkeyHex, pubkeyHex;
        
        if (typeof this.privkey === 'string') {
            privkeyHex = this.privkey;
        } else if (typeof window.NostrTools !== 'undefined' && window.NostrTools.nip19) {
            privkeyHex = Array.from(this.privkey).map(b => b.toString(16).padStart(2, '0')).join('');
        } else {
            privkeyHex = this.privkey;
        }
        
        if (typeof this.pubkey === 'string') {
            pubkeyHex = this.pubkey;
        } else if (typeof window.NostrTools !== 'undefined' && window.NostrTools.nip19) {
            pubkeyHex = Array.from(this.pubkey).map(b => b.toString(16).padStart(2, '0')).join('');
        } else {
            pubkeyHex = this.pubkey;
        }
        
        Storage.setCookie('nostr_privkey', privkeyHex);
        Storage.setCookie('nostr_pubkey', pubkeyHex);
    }

    loadFromStorage() {
        const privkeyHex = Storage.getCookie('nostr_privkey');
        const pubkeyHex = Storage.getCookie('nostr_pubkey');
        
        if (privkeyHex && pubkeyHex) {
            if (typeof window.NostrTools !== 'undefined') {
                try {
                    // Convert hex string to Uint8Array
                    this.privkey = new Uint8Array(privkeyHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                    this.pubkey = pubkeyHex;
                } catch (error) {
                    this.privkey = privkeyHex;
                    this.pubkey = pubkeyHex;
                }
            } else {
                this.privkey = privkeyHex;
                this.pubkey = pubkeyHex;
            }
            console.log('Loaded identity from storage:', pubkeyHex.slice(0, 8) + '...');
            return true;
        }
        return false;
    }

    clearStorage() {
        Storage.deleteCookie('nostr_privkey');
        Storage.deleteCookie('nostr_pubkey');
        this.privkey = null;
        this.pubkey = null;
    }
}