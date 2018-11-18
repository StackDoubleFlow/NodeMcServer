"use strict";

const net = require('net');
const packets = require('./packets.json');

var server;

class PacketBatch {
    constructor(buffer) {
        this.buffers = [];
        while(true) {
            var length = VarInt.decode(buffer, 0);
            this.buffers.push(buffer.slice(0, length.result + length.length));
            if(length.result + length.length == buffer.length) {
                break;
            }
            buffer = buffer.slice(length.result + length.length);
        }
    }
}

class Packet {
    constructor(buffer, boundTo, state) {
        this.buffer = buffer;
        this.boundTo = boundTo;
        this.state = state;
        this.error = false;
    }
    parse() {
        var dataLength, i, packetID;
        ({result: dataLength, length: i} = VarInt.decode(this.buffer, 0));
        dataLength -= i * 2;
        ({result: packetID, length: i} = VarInt.decode(this.buffer, i));
        dataLength += i + 1;
        var data = Buffer.alloc(dataLength);
        this.buffer.copy(data, 0, i, i + dataLength);
        this.data = data;
        this.packetID = packetID;
        this.readPacketData();

    }
    readPacketData() {
        for(var packet in packets[this.boundTo]) {
            if(packets[this.boundTo][packet]["ID"] == this.packetID && packets[this.boundTo][packet]["State"] == this.state) {
                this.name = packet;
                if(packets[this.boundTo][packet]["HandlerID"] != undefined) {
                    this.handlerID = packets[this.boundTo][packet]["HandlerID"];
                } else  {
                    this.handlerID = -1;
                }
            }
        }
        if(!this.name) {
            console.log("Unknown packet with ID " + this.packetID + " in state " + this.state);
            this.error = true;
            return;
        }
        var fieldNames = packets[this.boundTo][this.name]["Fields"];
        if(this.boundTo != "ClientBound") {
            console.log("C→S Packet \"" + this.name + "\"");
        } else {
            console.log("S→C Packet \"" + this.name + "\"");
        }
        this.getPacketfields(fieldNames);
    }
    getPacketfields(fieldNames) {
        var i = 0;
        this.fields = [];
        fieldNames.forEach((fieldName)=> {
            var value;
            switch(fieldName) {
                case "VarInt": 
                    ({result: value, length: i} = VarInt.decode(this.data, i));
                    this.fields.push(value);
                    break;
                case "String":
                    ({result: value, length: i} = ServerString.decode(this.data, i));
                    this.fields.push(value);
                    break;
                case "Unsigned Short":
                    this.fields.push((this.data[i] << 8) | this.data[i + 1]);
                    i += 2;
                    break;
                case "Unsigned Byte":
                    this.fields.push(this.data.readInt8(i));
                    i += 1;
                    break;
                case "Long":
                    this.fields.push((this.data.readUInt32BE(i) << 32) | this.data.readUInt32BE(i + 4));
                    i += 8;
                    break;
                case "Byte":
                    this.fields.push(this.data.readInt8(i));
                    i += 1;
                    break;
                case "Boolean":
                    var temp = this.data.readInt8(i);
                    if(temp == 1) this.fields.push(true)
                    else this.fields.push(false);
                    break;
                case "Identifier":
                    ({result: value, length: i} = ServerString.decode(this.data, i));
                    this.fields.push(value);
                    break;
                case "Byte Array":
                    this.fields.push(this.decodeUniqueByteArray(i));
                    break;
            }
        });
    }
    decodeUniqueByteArray(i) {
        switch(this.packetID) {
            case 0x0A:
                var length = this.data.length - i;
                var output = [];
                for(var j = 0; j < length; j++) {
                    output.push(this.data.readInt8(i + j));
                }
                return output;
        }
    }
}

class ChunkFactory {
    static createPacket(x, z) {
        var data = Buffer.alloc(0);
        data = Buffer.concat([data, VarInt.encode(x)]);
        data = Buffer.concat([data, VarInt.encode(z)]);
        data = Buffer.concat([data, Buffer.from([0x1])]);
        data = Buffer.concat([data, VarInt.encode(4)]);
        var chunkData = this.calculateChunkData();
        data = Buffer.concat([data, VarInt.encode(chunkData.length)]);
        data = Buffer.concat([data, chunkData]);
        data = Buffer.concat([data, VarInt.encode(0)]);
        var packetData = Buffer.concat([VarInt.encode(32), data]);
        var fullPacket = Buffer.concat([VarInt.encode(packetData.length), packetData]);
        var packet = new Packet(fullPacket, "ClientBound", "Play");
        return packet;
    }
    static calculateChunkData() {
        var temp = Buffer.alloc(0);
        temp = this.calcualteChunkSection(temp);
        temp = this.calcualteChunkSection(temp);
        temp = this.calcualteChunkSection(temp);
        temp = this.calcualteChunkSection(temp);
        return temp;
    }

    static calcualteChunkSection(data) {
        var longs = this.calculateLongs(14);
        // write bitsPerBlock
        var temp = Buffer.alloc(1);
        temp.writeUInt8(14);
        data = Buffer.concat([data, temp]);
        // write data length
        data = Buffer.concat([data, VarInt.encode(longs.length)]);
        // write data
        data = Buffer.concat([data, longs]);
        // write block light and sky light
        var temp = Buffer.alloc(2048, 0xFF);
        data = Buffer.concat([data, temp, temp]);
        return data;
    }

    static calculateLongs(bitsPerBlock) {
        var longs = [];
        var blockID = 1;
        var metadata = 0;
        var current = 0;
        var currentI = 64 - bitsPerBlock;
        var temp = (blockID << 4) | metadata;
        for(var i = 0; i < 4096; i++) {
            if(currentI < 0) {
                var neg = currentI - bitsPerBlock;
                current |= temp >> -neg;
                longs.push(current);
                current = 0;
                currentI = 64 - -neg;
                current |= temp << currentI;
                currentI -= bitsPerBlock;
            } else {
                current |= temp << currentI;
                currentI -= bitsPerBlock;
            }
          
        }

        var data = Buffer.alloc(0);
        for(var i = 0; i < longs.length; i++) {
            var temp = Buffer.alloc(8);
            temp.writeUInt32BE((longs[i] & 0xFFFFFFFF00000000) >>> 32, 0);
            temp.writeUInt32BE((longs[i] & 0x00000000FFFFFFFF) >>> 0, 4);
            data = Buffer.concat([data, temp]);
        }
        return data;
    }

}

class PacketFactory {
    static createPacket(name, fields, state) {
        var packetID = packets["ClientBound"][name]["ID"];
        var fieldNames = packets["ClientBound"][name]["Fields"];
        var data = Buffer.alloc(0);
        var i = 0;
        if(name == "Chunk Data") {
            var packet = new Packet(ChunkFactory.createPacket(fields[0], fields[1]), "ClientBound", state);
            packet.name = "Chunk Data";
            return packet;
        }
        fieldNames.forEach((fieldName) => {
            switch(fieldName) {
                case "VarInt": 
                    data = Buffer.concat([data, VarInt.encode(fields[i])]);
                    break;
                case "String":
                    data = Buffer.concat([data, ServerString.encode(fields[i])]);
                    break;
                case "Unsigned Short":
                    var temp = Buffer.alloc(2);
                    temp.writeUInt16BE(fields[i]);
                    data = Buffer.concat([data, temp]);
                    break;
                case "Unsigned Byte":
                    var temp = Buffer.alloc(1);
                    temp.writeUInt8(fields[i]);
                    data = Buffer.concat([data, temp]);
                    break;
                case "Long":
                    var temp = Buffer.alloc(8);
                    temp.writeUInt32BE((fields[i] & 0xFFFFFFFF00000000) >>> 32, 0);
                    temp.writeUInt32BE((fields[i] & 0x00000000FFFFFFFF) >>> 0, 4);
                    data = Buffer.concat([data, temp]);
                    break;
                case "Int":
                    var temp = Buffer.alloc(4);
                    temp.writeInt32BE(fields[i]);
                    data = Buffer.concat([data, temp]);
                    break;
                case "Boolean":
                    if(fields[i]) data = Buffer.concat([data, Buffer.from([0x1])])
                    else data = Buffer.concat([data, Buffer.from([0x0])]);
                    break;
                case "Double":
                    var temp = Buffer.alloc(8);
                    temp.writeDoubleBE(fields[i]);
                    data = Buffer.concat([data, temp]);
                    break;
                case "Float":
                    var temp = Buffer.alloc(4);
                    temp.writeFloatBE(fields[i]);
                    data = Buffer.concat([data, temp]);
                    break;
                case "Byte":
                    var temp = Buffer.alloc(1);
                    temp.writeUInt8(fields[i]);
                    data = Buffer.concat([data, temp]);
                    break;
            }
            i++;
        });
        var packetData = Buffer.concat([VarInt.encode(packetID), data]);
        var fullPacket = Buffer.concat([VarInt.encode(packetData.length), packetData]);
        var packet = new Packet(fullPacket, "ClientBound", state);
        packet.name = name;
        return packet;
    }
}



class Client {
    constructor(c, ID) {
        c.on('end', this.onDisconect);
        c.on('data', this.onData.bind(this));
        c.on('error', this.onDisconect);
        this.ID = ID;
        this.c = c;
        this.state = "Handshaking";
        this.handlers = [this.HandshakeHandler, this.SLPRequestHandler, this.PingHandler, this.LoginStartHander];
    }
    sendKeepAlive() {
        if(this.state == "Play") {
            this.sendPacket(PacketFactory.createPacket("Keep Alive", [new Date().getTime()], this.state));
        }
    }
    setState(state) {
        this.state = state;
    }
    sendPacket(packet) {
        console.log("S→C Packet \"" + packet.name + "\"");
        this.c.write(packet.buffer);
    }
    onDisconect() {
        console.log("disconnect~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
        server.deleteClient(this.ID);
    }
    onData(data) {
        var packets = new PacketBatch(data).buffers;
        //console.log("Received " + packets.length + " packets at once");
        for(var buffer in packets) {
            var packet = new Packet(packets[buffer], "ServerBound", this.state);
            packet.parse();
            if(packet.error | packet.handlerID == -1) return;
            if(!this.handlers[packet.handlerID]) {
                console.log("Handler ID " + packet.handlerID + " is missing!");
                return;
            }
            this.handlers[packet.handlerID].bind(this)(packet.fields);
        }
        
    }
    HandshakeHandler(fields) { // 0
        var protocall = fields[0], address = fields[1], port = fields[2], nextState = fields[3];
        if(nextState == 1) {
            this.state = "SLP";
        } else {
            this.state = "Login";
        }
    }
    SLPRequestHandler(fields) { // 1
        this.sendPacket(PacketFactory.createPacket("SLPResponse", 
        [
            '{"version":{"name":"1.12.2","protocol":340},"players":{"max":100,"online":1,"sample":[{"name":"StackDoubleFlow","id":"2d553c1d-4eab-4f63-8191-a9b0f9d69d0d"}]},"description":{"text":"Hello world"}}'
        ], this.state));
    }
    PingHandler(fields) { // 2
        this.sendPacket(PacketFactory.createPacket("Pong", fields, this.state));
        this.c.end();
    }
    LoginStartHander(fields) { // 3
        this.username = fields[0];
        this.sendPacket(PacketFactory.createPacket("Login Success", ["2d553c1d-4eab-4f63-8191-a9b0f9d69d0d", this.username], this.state));
        this.state = "Play";
        this.sendPacket(PacketFactory.createPacket("Join Game", [0, 1, 0, 2, 21, "flat", false], this.state));
        this.sendPacket(PacketFactory.createPacket("Player Position And Look", [0, 64, 0, 0, 0, 0, 0], this.state));
        this.sendPacket(PacketFactory.createPacket("Chunk Data", [0, 0], this.state));
        this.sendPacket(PacketFactory.createPacket("Chunk Data", [-1, 0], this.state));
        this.sendPacket(PacketFactory.createPacket("Chunk Data", [0, -1], this.state));
        this.sendPacket(PacketFactory.createPacket("Chunk Data", [-1, -1], this.state));
    }
}

class Server {
    constructor(hostname, port, maxPlayers) {
        this.hostname = hostname;
        this.port = port;
        this.clients = [];
        this.server = net.createServer((c) => {
            console.log("new~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
            var client = new Client(c, this.clients.length);
            this.clients.push(client);
        });
        this.server.listen(this.port, this.hostname, maxPlayers, ()=>{});
        this.server.on('close', (hadError) => {
            if(!hadError) {
                console.log("Server closed.");
            } else {
                console.error("Server closed due to an error!");
            }
        });
        setInterval(this.sendKeepAlives.bind(this), 10000);
    }
    sendKeepAlives() {
        for(var clientID in this.clients) {
            this.clients[clientID].sendKeepAlive();
        }
    }
    deleteClient(ID) {
        this.clients.splice(ID, 1);
    }
}

class VarInt {
    static decode(buffer, index) {
        var numRead = 0;
        var result = 0;
        var read;
        do {
            read = buffer[numRead + index];
            var value = (read & 0b01111111);
            result |= (value << (7 * numRead));
            numRead++;
        } while ((read & 0b10000000) != 0);
        return {result: result, length: numRead + index};
    }

    static encode(value) {
        var bytes = [];
        do {
            var temp = (value & 0b01111111);
            value >>>= 7;
            if (value != 0) {
                temp |= 0b10000000;
            }
            bytes.push(temp);
        } while (value != 0);
        return Buffer.from(bytes);
    }
}

class VarLong {
    static decode(buffer) {

    }

    static encode() {
        
    }
}

class Long {
    static decode(buffer) {
        
    }

    static encode(value) {
        var byteArray = [0, 0, 0, 0, 0, 0, 0, 0];
    
        for (var index = 0; index < byteArray.length; index++) {
            var byte = value & 0xff;
            byteArray[index] = byte;
            value = (value - byte) / 256;
        }
        byteArray.reverse();
        return Buffer.from(byteArray);
    }
}

class ServerString {
    static decode(buffer, index) {
        var length;
        ({result: length, length: index} = VarInt.decode(buffer, index));
        return {result: buffer.toString('utf-8', index, index + length), length: index + length};
    }
    static encode(string) {
        return Buffer.concat([VarInt.encode(string.length), Buffer.from(string, "utf-8")]);
    }
}

server = new Server("127.0.0.1", 25565, 20);
