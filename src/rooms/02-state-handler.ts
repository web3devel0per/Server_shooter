import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

export class Player extends Schema {
    @type("int16")
    loss = 0;

    @type("int8")
    maxHP = 0;

    @type("int8")
    currentHP = 0;

    @type("number")
    speed = 0;

    @type("number")
    pX = Math.floor(Math.random() * 50) - 25;

    @type("number")
    pY = 0;
    
    @type("number")
    pZ = Math.floor(Math.random() * 50) - 25;
    
    @type("number")
    vX = 0;
    
    @type("number")
    vY = 0;
    
    @type("number")
    vZ = 0;

    @type("number")
    rX = 0;
    
    @type("number")
    rY = 0;

    spawnIndex: number = -1; // индекс занятой точки спавна
}

export class State extends Schema {
    @type({ map: Player }) 
    players = new MapSchema<Player>();

    // Список заранее подготовленных спавн-точек
    private spawnPoints = [
        { x: -20, z: -20 },
        { x:  20, z: -20 },
        { x: -20, z:  20 },
        { x:  20, z:  20 },
        { x:   0, z: -25 },
        { x:  25, z:   0 },
        { x:   0, z:  25 },
        { x: -25, z:   0 }
    ];

    // хранит занятые индексы
    private spawnUsed: Set<number> = new Set<number>();

    // создаём игрока
    createPlayer(sessionId: string, data: any) {
        const player = new Player();
        player.maxHP = data.hp;
        player.currentHP = data.hp;
        player.speed = data.speed;

        // ищем первую свободную точку
        let spawnIndex = 0;
        while (this.spawnUsed.has(spawnIndex) && spawnIndex < this.spawnPoints.length) {
            spawnIndex++;
        }

        // если все заняты — fallback на 0
        if (spawnIndex >= this.spawnPoints.length) spawnIndex = 0;

        this.spawnUsed.add(spawnIndex);
        player.spawnIndex = spawnIndex;

        const { x, z } = this.spawnPoints[spawnIndex];
        player.pX = x;
        player.pY = 0;
        player.pZ = z;

        this.players.set(sessionId, player);
    }

    // --- удаляем игрока и освобождаем его точку ---
    removePlayer(sessionId: string) {
        const player = this.players.get(sessionId);
        if (player && player.spawnIndex !== -1) {
            this.releaseSpawn(player.spawnIndex);
        }
        this.players.delete(sessionId);
    }

    // освобождение слота спавна (интерфейс)
    releaseSpawn(index: number) {
        if (index === -1) return;
        this.spawnUsed.delete(index);
    }

    // возвращает новую (другую) точку спавна
    getNextSpawnPoint(currentIndex: number): { index: number; x: number; z: number } {
        let newIndex = (currentIndex + 1) % this.spawnPoints.length;

        // ищем первую свободную и не совпадающую точку
        for (let i = 0; i < this.spawnPoints.length; i++) {
            const idx = (currentIndex + 1 + i) % this.spawnPoints.length;
            if (!this.spawnUsed.has(idx)) {
                newIndex = idx;
                break;
            }
        }

        this.spawnUsed.add(newIndex);
        const { x, z } = this.spawnPoints[newIndex];
        return { index: newIndex, x, z };
    }

    // обновляем движение игрока
    movePlayer(sessionId: string, data: any) {
        const player = this.players.get(sessionId);
        if (!player) return;

        player.pX = data.pX;
        player.pY = data.pY;
        player.pZ = data.pZ;

        player.vX = data.vX;
        player.vY = data.vY;
        player.vZ = data.vZ;

        player.rX = data.rX;
        player.rY = data.rY;
    }
}

export class StateHandlerRoom extends Room<State> {
    maxClients = 8;

    onCreate(options) {
        console.log("StateHandlerRoom created!");
        this.setState(new State());

        this.onMessage("move", (client, data) => {
            this.state.movePlayer(client.sessionId, data);
        });

        this.onMessage("shoot", (client, data) => {
            this.broadcast("Shoot", data, { except: client });
        });

        this.onMessage("damage", (client, data) => {
            const clientID = data.id;
            const player = this.state.players.get(clientID);
            if (!player) return;

            let hp = player.currentHP - data.value;
            if (hp > 0) {
                player.currentHP = hp;
                return;
            }

            player.loss++;
            player.currentHP = player.maxHP;

            for (var i = 0; i < this.clients.length; i++) {
                if (this.clients[i].id != clientID) continue;

                 // сохраняем старый индекс, но НЕ освобождаем его пока не назначим новый
                const prevIndex = player.spawnIndex;

                // получаем новую точку (отличную от prevIndex, если возможно)
                const nextSpawn = this.state.getNextSpawnPoint(prevIndex);

                // назначаем игроку новую точку
                player.spawnIndex = nextSpawn.index;
                player.pX = nextSpawn.x;
                player.pZ = nextSpawn.z;
                player.pY = 0;

                // теперь можем освободить старый слот (если он существует и отличается от нового)
                if (prevIndex !== -1 && prevIndex !== nextSpawn.index) {
                    this.state.releaseSpawn(prevIndex);
                }


                const message = JSON.stringify({ x: player.pX, z: player.pZ });
                this.clients[i].send("Restart", message);
                break
            }

        });
    }

    onAuth(client, options, req) {
        return true;
    }

    onJoin(client: Client, data: any) {
        if(this.clients.length > this.maxClients) this.lock();

        client.send("hello", "world");
        this.state.createPlayer(client.sessionId, data);
    }

    onLeave(client: Client) {
        this.state.removePlayer(client.sessionId);
    }

    onDispose() {
        console.log("Dispose StateHandlerRoom");
    }
}