"use strict";

const net = require('net');
const packets = require('./packets.json');

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
        dataLength += i;
        var data = Buffer.alloc(dataLength + 1);
        this.buffer.copy(data, 0, i, i + dataLength + 1);
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
        console.log("Decoded packet \"" + this.name + "\" with the fields of " + fieldNames);
        this.getPacketFeilds(fieldNames);
    }
    getPacketFeilds(fieldNames) {
        var i = 0;
        this.feilds = [];
        fieldNames.forEach((fieldName)=> {
            var value;
            switch(fieldName) {
                case "VarInt": 
                    ({result: value, length: i} = VarInt.decode(this.data, i));
                    this.feilds.push(value);
                    break;
                case "String":
                    ({result: value, length: i} = ServerString.decode(this.data, i));
                    this.feilds.push(value);
                    break;
                case "Unsigned Short":
                    this.feilds.push((this.data[i] << 8) | this.data[i + 1]);
                    i += 2;
                    break;
                case "Long":
                    var temp = 0;
                    for(var j = i; j < i + 8; j++) {
                        temp = (this.data[i] << (8 * j)) | temp;
                    }
                    this.fields.push(temp);
                    i += 8;
                    break;
            }
        });
    }
}

class PacketFactory {
    static createPacket(name, fields, state) {
        var packetID = packets["ClientBound"][name]["ID"];
        var fieldNames = packets["ClientBound"][name]["Fields"];
        var data = Buffer.alloc(0);
        var i = 0;
        fieldNames.forEach((fieldName) => {
            var value;
            switch(fieldName) {
                case "VarInt": 
                    data = Buffer.concat([data, VarInt.encode(fields[i])]);
                    break;
                case "String":
                    data = Buffer.concat([data, ServerString.encode(fields[i])]);
                    break;
                case "Unsigned Short":
                    data = Buffer.concat([data, fields[i] & 0xFFFF]);
                    break;
            }
            i++;
        });
        var packetData = Buffer.concat([VarInt.encode(packetID), data]);
        var fullPacket = Buffer.concat([VarInt.encode(packetData.length), packetData]);
        return new Packet(fullPacket, "ClientBound", state);
    }
}


class Client {
    constructor(c) {
        c.on('end', this.onDisconect);
        c.on('data', this.onData.bind(this));
        this.c = c;
        this.state = "Handshaking";
        this.handlers = [this.HandshakeHandler, this.SLPRequestHandler, this.PingHandler];
    }
    sendPacket(packet) {
        c.write(packet.buffer);
    }
    onDisconect() {

    }
    onData(data) {
        var packet = new Packet(data, "ServerBound", this.state);
        packet.parse();
        if(packet.error | packet.handlerID == -1) return;
        this.handlers[packet.handlerID](packet.feilds);
    }
    HandshakeHanlder(fields) { // 0
        var protocall = fields[0], address = fields[1], port = fields[2], nextState = fields[3];
        if(nextState == 1) {
            this.state = "SLP";
        } else {
            this.state = "Login";
        }
    }
    SLPRequestHandler(fields) { // 1

    }
    PingHandler(fields) { // 2

    }
}

class Server {
    constructor(hostname, port, maxPlayers) {
        this.hostname = hostname;
        this.port = port;
        this.clients = [];
        this.server = net.createServer((c) => {
            var client = new Client(c);
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
        var buffer = Buffer.alloc(0);
        do {
            var temp = value & 0b01111111;
            value >>>=7;
            if (value != 0) {
                temp |= 0b10000000;
            }
            buffer.concat(buffer, [temp]);
        } while (value != 0);
        console.log(buffer);
        return buffer;
    }
}

class VarLong {
    static decode(buffer) {

    }

    static encode() {
        
    }
}

class ServerString {
    static decode(buffer, index) {
        var length;
        ({result: length, length: index} = VarInt.decode(buffer, index));
        return {result: buffer.toString('utf-8', index, index + length), length: index + length};
    }
    static encode(string) {
        var output = Buffer.concat(VarInt.encode(string.length), Buffer.from(string, "utf-8"))
    }
}

var server = new Server("127.0.0.1", 25565, 20);
