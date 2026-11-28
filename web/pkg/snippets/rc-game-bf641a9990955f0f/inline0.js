
        const cardPrefix = 'rerac.memcard.v1:';
        const cardPath = (path) => String(path).replace(/\\/g, '/').replace(/^\/+/, '');
        export function rerac_card_is_dir(path) {
            try { return localStorage.getItem(cardPrefix + 'dir:' + cardPath(path)) === '1'; }
            catch { return false; }
        }
        export function rerac_card_make_dir(path) {
            try { localStorage.setItem(cardPrefix + 'dir:' + cardPath(path), '1'); return true; }
            catch { return false; }
        }
        export function rerac_card_read(path) {
            try {
                const value = localStorage.getItem(cardPrefix + 'file:' + cardPath(path));
                if (value === null) return null;
                const binary = atob(value);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return bytes;
            } catch { return null; }
        }
        export function rerac_card_write(path, bytes) {
            try {
                let binary = '';
                for (let i = 0; i < bytes.length; i += 0x4000) {
                    binary += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
                }
                localStorage.setItem(cardPrefix + 'file:' + cardPath(path), btoa(binary));
                return true;
            } catch { return false; }
        }
