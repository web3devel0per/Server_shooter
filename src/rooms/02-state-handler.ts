import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

export class Player extends Schema {
    @type("int8")
    skin = 0;

    @type("int16")
    loss = 0;

    @type("int8")
    maxHP = 0;

    @type("int8")
    currentHP = 0;

    @type("number")
    speed = 0;

    @type("number")
    pX = 0;

    @type("number")
    pY = 0;
    
    @type("number")
    pZ = 0;
    
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
    createPlayer(sessionId: string, data: any, skin: number) {
        const player = new Player();
        player.skin = skin;
        player.maxHP = data.hp;
        player.currentHP = data.hp;
        player.speed = data.speed;
        player.pX = data.pX;
        player.pY = data.pY;
        player.pZ = data.pZ;
        player.rY = data.rY;

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
    spawnPointCount = 8;
    skins: number[] = [0]

    mixArray(arr){
    var currentIndex = arr.length;
    var tmpValue, randomIndex;

    // Пока остаются элементы для перемешивания
    while(currentIndex != 0){
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;
        tmpValue = arr[currentIndex];
        arr[currentIndex] = arr[randomIndex];
        arr[randomIndex] = tmpValue;
    }
}

    onCreate(options) {
        console.log("StateHandlerRoom created!");

        for (var i = 1; i < options.skins; i++){
            this.skins.push(i)
        }
        this.mixArray(this.skins)

        this.spawnPointCount = options.points;

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
                const point = Math.floor(Math.random() * this.spawnPointCount);
                this.clients[i].send("Restart", point);
                break
            }

        });
    }

    onAuth(client, options, req) {
        return true;
    }

    onJoin(client: Client, data: any) {
        if(this.clients.length > this.maxClients) this.lock();
        console.log('this.skins', this.skins)
        const skin = this.skins[this.clients.length - 1]
        this.state.createPlayer(client.sessionId, data, skin);
    }

    onLeave(client: Client) {
        this.state.removePlayer(client.sessionId);
    }

    onDispose() {
        console.log("Dispose StateHandlerRoom");
    }
}