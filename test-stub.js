require('dotenv').config({ path: './test-stub.env' });
const db = require('./db');
const mqtt = require('mqtt');
const numeral = require('numeral');
const moment = require("moment");
const crc16 = require('crc').crc16modbus;
const MQTT_BOTTOMUP_TOPIC = process.env.MQTT_BOTTOMUP_TOPIC;

var interval_handles = {};
var nozzle_state_dict = {};
var mqtt_clients = {};
// 模拟所有分控箱
db.exec("select distinct(no) from controlbox order by no", [], function (controlboxes) {
    controlboxes.forEach(function (controlbox, index, arr) {
        var controlbox_no = numeral(controlbox.no).format('000');
        nozzle_state_dict[controlbox_no] = "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
        var mqtt_client = mqtt.connect(process.env.MQTT_URL, {username: process.env.MQTT_USER, password: process.env.MQTT_PASSWORD, clientId: controlbox_no, clean: false});
        mqtt_client.subscribe(process.env.MQTT_TOPDOWN_TOPIC, {qos: 1});
        mqtt_client.on("message", function (topic, message) {
            recv_msg(controlbox_no, message);
        });
        mqtt_clients[controlbox_no] = mqtt_client;
        setTimeout(function(controlbox_no, mqtt_client) {
            interval_handles[controlbox_no] = setInterval(function(controlbox_no, mqtt_client) {
                var command = process.env.COMMAND_NOZZLE_STATE + "|" + controlbox_no + "|" + nozzle_state_dict[controlbox_no] + "|1|";
                command = command + left_pad(crc16(command).toString(16), 4);
                mqtt_client.publish(MQTT_BOTTOMUP_TOPIC, command, {qos: 1}, function (err) {
                    if (err) {
                        console.log("[" + moment().format("YYYY-MM-DD HH:mm:ss") + "] " + controlbox_no + "号箱上送状态指令出错，连接broker失败");
                    } else {
                        console.log("[" + moment().format("YYYY-MM-DD HH:mm:ss") + "] " + controlbox_no + "号箱上送状态指令");
                    }
                });
            }, 60000, controlbox_no, mqtt_client);  // 每分钟分控箱都要定时上送所有洒水站的状态
        }, random(1, 60) * 1000, controlbox_no, mqtt_client);
    });
});
function random(lowerValue, upperValue) {
    return Math.floor(Math.random() * (upperValue - lowerValue + 1) + lowerValue);
}
var myInterval = setInterval(function() {
    db.exec("select distinct(no) from controlbox order by no", [], function (controlboxes) {
        controlboxes.forEach(function (controlbox, index, arr) {
            var controlbox_no = numeral(controlbox.no).format('000');
            if (!(controlbox_no in nozzle_state_dict)) {
                nozzle_state_dict[controlbox_no] = "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
                var mqtt_client = mqtt.connect(process.env.MQTT_URL, {username: process.env.MQTT_USER, password: process.env.MQTT_PASSWORD, clientId: controlbox_no, clean: false});
                mqtt_client.subscribe(process.env.MQTT_TOPDOWN_TOPIC, {qos: 1});
                mqtt_client.on("message", function (topic, message) {
                    recv_msg(controlbox_no, message);
                });
                mqtt_clients[controlbox_no] = mqtt_client;
                setTimeout(function(controlbox_no, mqtt_client) {
                    interval_handles[controlbox_no] = setInterval(function(controlbox_no, mqtt_client) {
                        var command = process.env.COMMAND_NOZZLE_STATE + "|" + controlbox_no + "|" + nozzle_state_dict[controlbox_no] + "|1|";
                        command = command + left_pad(crc16(command).toString(16), 4);
                        mqtt_client.publish(MQTT_BOTTOMUP_TOPIC, command, {qos: 1}, function (err) {
                            if (err) {
                                console.log("[" + moment().format("YYYY-MM-DD HH:mm:ss") + "] " + controlbox_no + "号箱上送状态指令出错，连接broker失败");
                            } else {
                                console.log("[" + moment().format("YYYY-MM-DD HH:mm:ss") + "] " + controlbox_no + "号箱上送状态指令");
                            }
                        });
                    }, 60000, controlbox_no, mqtt_client);
                }, random(1, 60) * 1000, controlbox_no, mqtt_client);
            }
        });
        var controlbox_nos = [];
        for(i=0; i<controlboxes.length; i++) {
            controlbox_nos.push(numeral(controlboxes[i].no).format('000'));
        }
        var del_nos = [];
        for(var controlbox_no in nozzle_state_dict) {
            if (!controlbox_nos.includes(controlbox_no)) {
                clearInterval(interval_handles[controlbox_no]);
                delete interval_handles[controlbox_no];
                mqtt_clients[controlbox_no].unsubscribe(process.env.MQTT_TOPDOWN_TOPIC);
                mqtt_clients[controlbox_no].end(true);
                delete mqtt_clients[controlbox_no];
                del_nos.push(controlbox_no);
            }
        }
        for(var i=0; i<del_nos.length; i++) {
            delete nozzle_state_dict[del_nos[i]];
            console.log("删除了" + del_nos[i] + "号箱");
        }
    });
}, 600000);
// 接收中控系统发来的指令
function recv_msg(client_id, message) {
    var msg = message.toString();
    var current_time = moment().format("YYYY-MM-DD HH:mm:ss");
    if (check_crc(msg)) {
        var commands = msg.split("|");
        if (commands[0] === process.env.COMMAND_IRRIGATE) {  // 洒水
            if (parseInt(commands[1]) === msg.length) {
                var irrigate_nozzles = [];
                var nozzles = commands[2].split(';');
                for(i=0; i<nozzles.length; i++) {
                    var howlong = nozzles[i].split(',');
                    var x_y = howlong[0].split('-');
                    var controlbox_no = x_y[0];
                    if (controlbox_no === client_id) {
                        var nozzle_no = parseInt(x_y[1]);
                        irrigate_nozzles.push(nozzle_no);
                        setTimeout(function (controlbox_no, nozzle_no) {
                            var pos = (nozzle_no - 1) * 2;
                            var state = replacepos(nozzle_state_dict[controlbox_no], pos, '00');
                            nozzle_state_dict[controlbox_no] = state;
                            var command = process.env.COMMAND_NOZZLE_STATE + "|" + controlbox_no + "|" + state + "|1|";
                            command = command + left_pad(crc16(command).toString(16), 4);
                            mqtt_clients[controlbox_no].publish(MQTT_BOTTOMUP_TOPIC, command, {qos: 1}, function (err) {
                                if (err) {
                                    console.log("[" + current_time + "] " + controlbox_no + "号箱上送状态指令出错，连接broker失败");
                                } else {
                                    console.log("[" + current_time + "] " + controlbox_no + "号箱洒完水上送状态");
                                }
                            });
                        }, parseInt(howlong[1], 16) * 1000, controlbox_no, nozzle_no);
                    }
                }
                if (irrigate_nozzles.length > 0) {
                    var nozzle_state_string = nozzle_state_dict[client_id];
                    for(var i=0; i<irrigate_nozzles.length; i++) {
                        var pos = (irrigate_nozzles[i] - 1) * 2;
                        nozzle_state_string = replacepos(nozzle_state_string, pos, '01');
                    }
                    nozzle_state_dict[client_id] = nozzle_state_string;
                    command = process.env.COMMAND_NOZZLE_STATE + "|" + client_id + "|" + nozzle_state_string + "|1|";
                    command = command + left_pad(crc16(command).toString(16), 4);
                    mqtt_clients[client_id].publish(MQTT_BOTTOMUP_TOPIC, command, {qos: 1}, function (err) {
                        if (err) {
                            console.log("[" + current_time + "] " + client_id + "号箱上送状态指令出错，连接broker失败");
                        } else {
                            console.log("[" + current_time + "] " + client_id + "号箱上收到洒水指令上送状态");
                        }
                    });
                }
            } else {
                console.log("[" + current_time + "] 包长度错误：" + msg);
            }
        } else if (commands[0] === process.env.COMMAND_STOP) {  // 全部停止
            setTimeout(function(controlbox_no, mqtt_client) {
                var command = process.env.COMMAND_NOZZLE_STATE + "|" + controlbox_no + "|00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000|1|";
                command = command + left_pad(crc16(command).toString(16), 4);
                mqtt_client.publish(MQTT_BOTTOMUP_TOPIC, command, {qos: 1}, function (err) {
                    if (err) {
                        console.log("[" + current_time + "] " + controlbox_no + "号箱上送状态指令出错，连接broker失败");
                    } else {
                        nozzle_state_dict[controlbox_no] = "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
                        console.log("[" + current_time + "] " + controlbox_no + "号箱收到停止洒水指令上送状态");
                    }
                });
            }, random(1, 200), client_id, mqtt_clients[client_id]);
        } else if (commands[0] === process.env.COMMAND_REMOTE_OR_LOCAL_CONTROL) {
            controlbox_no = commands[1];
            if (controlbox_no === client_id) {
                var command = process.env.COMMAND_REMOTE_OR_LOCAL_CONTROL_FEEDBACK + "|" + controlbox_no + "|";
                command = command + left_pad(crc16(command).toString(16), 4);
                mqtt_clients[controlbox_no].publish(MQTT_BOTTOMUP_TOPIC, command, {qos: 1}, function (err) {
                    if (err) {
                        console.log("[" + current_time + "] " + controlbox_no + "号箱上送远程、本地反馈指令出错，连接broker失败");
                    } else {
                        console.log("[" + current_time + "] " + controlbox_no + "号箱上送远程、本地反馈指令");
                    }
                });
            }
        }
    } else {
        console.log("[" + current_time + "] CRC16校验错误：" + msg);
    }
}
function check_crc(message) {
    var str = message.substr(0, message.length - 4);
    var crc = message.substring(message.length - 4);
    return left_pad(crc16(str).toString(16), 4) === crc.toUpperCase();
}
function left_pad(num, n) {
    var len = num.toString().length;
    while(len < n) {
        num = "0" + num;
        len++;
    }
    return num.toUpperCase();
}
function replacepos(text, start, replacetext) {
    return text.substring(0, start) + replacetext + text.substring(start + replacetext.length);
}
// 退出程序
process.on('SIGINT', function() {
    clearInterval(myInterval);
    var del_nos = [];
    for(var controlbox_no in nozzle_state_dict) {
        clearInterval(interval_handles[controlbox_no]);
        delete interval_handles[controlbox_no];
        mqtt_clients[controlbox_no].unsubscribe(process.env.MQTT_TOPDOWN_TOPIC);
        mqtt_clients[controlbox_no].end(true);
        delete mqtt_clients[controlbox_no];
        del_nos.push(controlbox_no);
    }
    for(var i=0; i<del_nos.length; i++) {
        delete nozzle_state_dict[del_nos[i]];
        console.log("删除了" + del_nos[i] + "号箱");
    }
    interval_handles.clear();
    mqtt_clients.clear();
    nozzle_state_dict.clear();
    console.log('%s 应用退出', moment().format("YYYY-MM-DD HH:mm:ss"));
    process.exit();
});