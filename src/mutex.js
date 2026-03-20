/**
 * A simple Mutex (Mutual Exclusion) to handle async concurrency.
 * Ensures that code blocks (like file read-modify-write) are executed sequentially.
 */
class Mutex {
    constructor() {
        this.queue = [];
        this.locked = false;
    }

    /**
     * Acquires the lock.
     * @returns {Promise<Function>} A promise that resolves to a 'release' function.
     */
    lock() {
        return new Promise(resolve => {
            const release = () => {
                if (this.queue.length > 0) {
                    const next = this.queue.shift();
                    next();
                } else {
                    this.locked = false;
                }
            };

            if (this.locked) {
                this.queue.push(() => resolve(release));
            } else {
                this.locked = true;
                resolve(release);
            }
        });
    }
}

module.exports = Mutex;