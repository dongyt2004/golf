require('dotenv').config({ path: './app.env' });
process.env.TZ = "Asia/Shanghai";
const http = require('http');
const db = require('./db');
const express = require('express');
const favicon = require('serve-favicon');
const bodyParser = require('body-parser');
const adaro = require('adaro');
const eachAsync = require('each-async');
const path = require('path');
const _ = require('lodash');
const moment = require("moment");
const methodOverride = require('method-override');
const session = require('express-session');
const gcoord = require('gcoord');
var qos = 0, clean = true;
const mqtt = require('mqtt');
const mqtt_client  = mqtt.connect(process.env.MQTT_URL, {username: process.env.MQTT_USER, password: process.env.MQTT_PASSWORD, clientId: process.env.MQTT_USER + "-svc", clean: clean});
mqtt_client.on('connect', function () {
    mqtt_client.subscribe(process.env.MQTT_BOTTOMUP_TOPIC, {qos: qos});
});
const schedule = require('node-schedule');
const sizeOf = require('image-size');
var dimensions = sizeOf('static/地图.jpg');
var map_width = dimensions.width, map_height = dimensions.height;
const format = require('string-format');
const numeral = require('numeral');
const log4js = require('log4js');
const RedisStore = require('connect-redis')(session);
const redisClient = require('redis').createClient({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
});
const getFutureTiming = require('cronicle-client').getFutureTiming;
const CronicleClient = require('cronicle-client').CronicleClient;
const scheduler = new CronicleClient({
    masterUrl: process.env.CRONICLE_URL,
    apiKey: process.env.CRONICLE_API_KEY
});
const crc16 = require('crc').crc16modbus;
const EsClient = require('@elastic/elasticsearch');
const esClient = new EsClient.Client({
    node: process.env.ES_URL
});
const AsyncLock = require('async-lock');
const lock = new AsyncLock();
/** ------------------------------------------------------------------------------------ 测 试 ------------------------------------------------------------------------------------------ **/
// function add_100_controlboxes() {
//     var current_time = moment().format("YYYY-MM-DD HH:mm:ss");
//     for(var i=1; i<=100; i++) {
//         var r = Math.floor(Math.random()*256);
//         var g = Math.floor(Math.random()*256);
//         var b = Math.floor(Math.random()*256);
//         var color = '#' + r.toString(16) + g.toString(16) + b.toString(16);
//         db.exec("insert into controlbox(id,no,name,model_id,nozzle_count,color,last_recv_time) values(?,?,?,?,?,?,?)", [i, i, i + "号箱", random(4, 5), random(10, 64), color, current_time]);
//     }
// }
// function random(lowerValue, upperValue) {
//     return Math.floor(Math.random() * (upperValue - lowerValue + 1) + lowerValue);
// }
// add_100_controlboxes();
// console.log(gcoord.transform([117.3061177196, 38.9768560444], gcoord.BD09, gcoord.GCJ02));
/** --------------------------------------------------------------------------------- 计 算 crc16 ------------------------------------------------------------------------------------------ **/
// console.log(left_pad(crc16('1|002|00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000|1|').toString(16), 4));
/** ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- **/
var real_name = "未登录";
// 配置log4js
log4js.configure({
    appenders: {
        // 控制台
        console: {type: 'console',
            layout: {
                type: 'pattern',
                pattern: '%[%d{yyyy-MM-dd hh:mm:ss} [%p] %x{real_name}%] - %m',
                tokens: {
                    real_name: function(log_event) {
                        return real_name;
                    }
                }
            }
        },
        // 访问日志
        access: {type: 'dateFile', filename: 'log/access.log', daysToKeep: 7, keepFileExt: true,
            layout: {
                type: 'pattern',
                pattern: '%d{yyyy-MM-dd hh:mm:ss} [%p] %h - %m'
            }
        },
        // 本地存储日志
        local: {type: 'dateFile', filename: 'log/app.log', daysToKeep: 7, keepFileExt: true,
            layout: {
                type: 'pattern',
                pattern: '%d{yyyy-MM-dd hh:mm:ss} [%p] %h %x{real_name} - %m',
                tokens: {
                    real_name: function(log_event) {
                        return real_name;
                    }
                }
            }
        }/*,
        // 远程服务器统一存储
        remote: {type: 'tcp', host: process.env.LOG_SERVER_HOST, port: process.env.LOG_SERVER_PORT}*/
    },
    categories: {
        access: {appenders: ['access'], level: 'info'},
        default: {appenders: ['local'/*, 'remote'*/], level: 'debug'}  // 如果不是分布式，只file一个。如果多结点集群，则file，server两个。
    },
    pm2: true
});
const logger = log4js.getLogger();
// express
var app = express();
app.engine('dust', adaro.dust({
    helpers: ['dustjs-helpers']
}));
app.set('views', path.join(__dirname, 'view'));
app.set('view engine', 'dust');
app.use(log4js.connectLogger(log4js.getLogger('access'), {format: '[:remote-addr :method :url :status :response-timems][:referrer HTTP/:http-version :user-agent]'}));
app.use(favicon(path.join(__dirname, 'static', 'favicon.ico')));
app.use(bodyParser.text({limit: '10mb'}));
app.use(bodyParser.json({limit: '10mb'}));
app.use(bodyParser.urlencoded({limit: '100mb', extended: false}));
app.use(express.static(path.join(__dirname, 'static')));
app.use(methodOverride('X-HTTP-Method'));  // Microsoft
app.use(methodOverride('X-HTTP-Method-Override'));  // Google/GData
app.use(methodOverride('X-Method-Override'));  // IBM
app.use(methodOverride('_method'));
app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    rolling: true,
    cookie: {
        path: '/',
        httpOnly: true,
        secure: false,
        maxAge: 1800000
    }
}));
/** ------------------------------------------------------------------------------------ 向 elasticsearch 初 始 化 喷 头 坐 标 ------------------------------------------------------------------------------------------ **/
esClient.deleteByQuery({
    index: process.env.DATABASE,
    body: {
        query: {
            match_all: {}
        }
    }
});
db.exec("select id,nozzle_id,gps_lon,gps_lat from sprinkler where gps_lon is not null", [], function (sprinklers) {  // 在es中的必须是有坐标的
    var sp = [];
    for(var i=0; i<sprinklers.length; i++) {
        sp.push({
            id: sprinklers[i].id,
            nozzle_id: sprinklers[i].nozzle_id,
            location: {
                lat: sprinklers[i].gps_lat,
                lon: sprinklers[i].gps_lon
            }
        });
    }
    esClient.helpers.bulk({
        datasource: sp,
        onDocument (doc) {
            return {
                index: { _index: process.env.DATABASE, _id: doc.id }
            }
        }
    })
});
/** ------------------------------------------------------------------------------------- 启 动 时 调 度 的 作 业 ----------------------------------------------------------------------------------------------- **/
// 向Cronicle添加定时转储2天前的job
scheduler.getEvent({
    title: process.env.CLUB_NAME + '-dump_job'
}).catch(function() {  // 没有这个job，则创建
    scheduler.createEvent({
        title: process.env.CLUB_NAME + '-dump_job',
        catch_up: 1,
        enabled: 1,
        category: 'general',
        target: 'allgrp',
        algo: 'round_robin',
        plugin: 'urlplug',
        params: {
            method: 'get',
            url: 'http://' + process.env.SCHEDULED_SERVICE_ID + ":" + process.env.SCHEDULED_SERVICE_PORT + '/dump_job',
            success_match: '1',
            error_match: '0'
        },
        retries: 3,
        retry_delay: 30,
        timing: {
            "hours": [ 3 ],
            "minutes": [ 0 ]
        },
        timezone: 'Asia/Shanghai'
    }).then(function() {
        console.log(process.env.CLUB_NAME + '中控启动时向Cronicle添加转储job的事件');
    }).catch(function(err) {
        console.log(err.code + ":" + err.message);
        process.exit();
    });
});
// 向Cronicle添加定时转储3天前的plan
scheduler.getEvent({
    title: process.env.CLUB_NAME + '-dump_plan'
}).catch(function() {  // 没有这个plan，则创建
    scheduler.createEvent({
        title: process.env.CLUB_NAME + '-dump_plan',
        catch_up: 1,
        enabled: 1,
        category: 'general',
        target: 'allgrp',
        algo: 'round_robin',
        plugin: 'urlplug',
        params: {
            method: 'get',
            url: 'http://' + process.env.SCHEDULED_SERVICE_ID + ":" + process.env.SCHEDULED_SERVICE_PORT + '/dump_plan',
            success_match: '1',
            error_match: '0'
        },
        retries: 3,
        retry_delay: 30,
        timing: {
            "hours": [ 3 ],
            "minutes": [ 1 ]
        },
        timezone: 'Asia/Shanghai'
    }).then(function() {
        console.log(process.env.CLUB_NAME + '中控启动时向Cronicle添加转储plan的事件');
    }).catch(function(err) {
        console.log(err.code + ":" + err.message);
        process.exit();
    });
});
// 向Cronicle添加将来要调度的洒水计划
db.exec("select * from plan where start_time>=?", [moment().format("YYYY-MM-DD HH:mm:ss")], function (plans) {
    plans.forEach(function (plan, index, arr) {
        scheduler.getEvent({
            title: process.env.CLUB_NAME + "-plan" + plan.id
        }).catch(function() {  // 没有这个job，则创建
            scheduler.createEvent({
                title: process.env.CLUB_NAME + "-plan" + plan.id,
                catch_up: 1,
                enabled: 1,
                category: 'general',
                target: 'allgrp',
                algo: 'round_robin',
                plugin: 'urlplug',
                params: {
                    method: 'post',
                    url: 'http://' + process.env.SCHEDULED_SERVICE_ID + ":" + process.env.SCHEDULED_SERVICE_PORT + '/preprocess/' + plan.id,
                    success_match: '1',
                    error_match: '0'
                },
                retries: 3,
                retry_delay: 30,
                timing: getFutureTiming(moment(plan.start_time).subtract(10, 'seconds')),
                timezone: 'Asia/Shanghai'
            }).then(function() {
                console.log(process.env.CLUB_NAME + "中控启动时向Cronicle添加洒水计划%s，调度时间%s", plan.id, moment(plan.start_time).format("YYYY-MM-DD HH:mm:ss"));
            }).catch(function(err) {
                console.log(err.code + ":" + err.message);
                process.exit();
            });
        });
    });
});
// 每分钟调度一次，查看分控箱是否正常
setInterval(function() {
    db.exec("select id,last_recv_time from controlbox", [], function (controlboxes) {
        for(var i=0; i<controlboxes.length; i++) {
            if (controlboxes[i].last_recv_time !== null) {
                var diff = moment().diff(moment(controlboxes[i].last_recv_time), 'minute');
                if (diff >= 5) {
                    db.exec("update controlbox set use_state=0 where id=?", [controlboxes[i].id]);
                } else {
                    db.exec("update controlbox set use_state=1 where id=?", [controlboxes[i].id]);
                }
            }
        }
    });
}, 60000);
/** ------------------------------------------------------------------------------------- 自 动 暂 停 或 重 启 ----------------------------------------------------------------------------------------------- **/
// 暂停对象的构造函数
function Pause(cart_no, nozzle_id) {
    // 该非零元的行下标和列下标
    this.cart_no = cart_no || '';
    this.nozzle_id = nozzle_id || 0;
    this.pause_start_time = moment();
}
// 所有暂停对象的三元组表，行是车，列是nozzle
const pauses = [];
// 暂停后的自动发送洒水指令
function auto_send(nozzle_ids) {
    var where = "";
    for(var i=0; i<nozzle_ids.length; i++) {
        where += "a.id=" + nozzle_ids[i] + " or ";
    }
    where += "1=0";
    db.exec("select a.id as nozzle_id, a.remain_time, b.no as controlbox_no, a.no as nozzle_no from nozzle a join controlbox b on a.controlbox_id=b.id where a.use_state=1 and a.state=0 and (" + where + ")", [], function (results) {
        var commands = [], values = [];
        var start_time = moment().format("YYYY-MM-DD HH:mm:ss");
        for(var i=0; i<results.length; i++) {
            commands.push(numeral(results[i].controlbox_no).format('000') + "-" + numeral(results[i].nozzle_no).format('00') + "," + left_pad(results[i].remain_time.toString(16), 4));
            values.push("(" + results[i].nozzle_id + ",'" + results[i].controlbox_no + "-" + results[i].nozzle_no + "','" + start_time + "'," + results[i].remain_time + ")");
        }
        var command = commands[0], value = values[0];
        for(i=1; i<commands.length; i++) {
            if (i % process.env.COMMAND_BATCH_SIZE === 0) {
                command = process.env.COMMAND_IRRIGATE + "|{}|" + command + "|";
                command = format(command, numeral(command.length + 1 + 4).format('000'));
                command = command + left_pad(crc16(command).toString(16), 4);
                mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
                    if (!err) {
                        console.log("[" + start_time + "] " + process.env.CLUB_NAME + "中控暂停后又自动下发洒水指令：" + command);
                        try {
                            db.exec("insert into job(nozzle_id,nozzle_address,start_time,how_long) values " + value, []);
                        } catch (e) {
                        }
                    } else {
                        return false;
                    }
                });
                command = commands[i];
                value = values[i];
            } else {
                command += ";" + commands[i];
                value += "," + values[i];
            }
        }
        command = process.env.COMMAND_IRRIGATE + "|{}|" + command + "|";
        command = format(command, numeral(command.length + 1 + 4).format('000'));
        command = command + left_pad(crc16(command).toString(16), 4);
        mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
            if (!err) {
                console.log("[" + start_time + "] " + process.env.CLUB_NAME + "中控暂停后又自动下发洒水指令：" + command);
                try {
                    db.exec("insert into job(nozzle_id,nozzle_address,start_time,how_long) values " + value, [], function() {
                        return true;
                    });
                } catch (e) {
                    return false;
                }
            } else {
                return false;
            }
        });
    });
}
// 基于距离自动停止洒水
function auto_stop(nozzle_ids) {
    var where = "";
    for(var i=0; i<nozzle_ids.length; i++) {
        where += "a.id=" + nozzle_ids[i] + " or ";
    }
    where += "1=0";
    db.exec("select b.no as controlbox_no, a.no as nozzle_no from nozzle a join controlbox b on a.controlbox_id=b.id where a.use_state=1 and a.state=1 and (" + where + ")", [], function (results) {
        var s = "";
        for(var i=0; i<results.length;i++) {
            s += numeral(results[i].controlbox_no).format('000') + "-" + numeral(results[i].nozzle_no).format('00') + ",";
        }
        if (s.length > 0) {
            s = s.substr(0, s.length - 1);
        }
        var command = process.env.COMMAND_STOP_SOME + "|";
        command += s + "|";
        command = command + left_pad(crc16(command).toString(16), 4);
        mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
            if (!err) {
                console.log("[" + moment().format("YYYY-MM-DD HH:mm:ss") + "] " + process.env.CLUB_NAME + "中控自动下发暂停洒水指令：" + command);
                return true;
            } else {
                return false;
            }
        });
    });
}
// 根据两点gps坐标，计算它们的方位角（0~360°）
function getAngleByGps(lng1, lat1, lng2, lat2){
    var x = Math.sin(lng2 - lng1) * Math.cos(lat2);
    var y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
    var angle = Math.atan2(x, y) * 180 / Math.PI;
    return angle > 0 ? angle : angle + 360;
}
/** ------------------------------------------------------------------------------------- 订 阅 ----------------------------------------------------------------------------------------------- **/
mqtt_client.on("message", function (topic, message) {
    var msg = message.toString();
    var current_time = moment().format("YYYY-MM-DD HH:mm:ss");
    if (check_crc(msg)) {
        var commands = msg.split("|");
        if (commands[0] === process.env.COMMAND_NOZZLE_STATE) {
            if (commands[3] === "1") {  // 远程控制模式，本地控制模式下忽略此命令
                // 必须是幂等操作
                var controlbox_no = parseInt(commands[1]);
                db.exec("update controlbox set use_state=1,last_recv_time=? where no=?", [current_time, controlbox_no], function (results) {
                    var up_states = [];
                    for(var i=0; i<commands[2].length; i=i+2) {
                        up_states[i/2 + 1] = parseInt(commands[2].substr(i, 2));
                    }
                    db.exec("select a.id as id,a.no as no,a.state from nozzle a join controlbox b on a.controlbox_id=b.id and b.no=?", [controlbox_no], function (nozzles) {
                        eachAsync(nozzles, function(nozzle, index, done) {
                            if (up_states[nozzle.no] !== nozzle.state) {
                                if (up_states[nozzle.no] === 0) {
                                    db.exec("select start_time, how_long from job where nozzle_id=? and start_time<? and end_time is null", [nozzle.id, current_time], function (jobs) {
                                        if (jobs.length > 0) {
                                            var remain_time = jobs[0].how_long - moment().diff(moment(jobs[0].start_time), 'second');
                                            if (remain_time > 0) {  // 提前结束
                                                db.exec("update nozzle set state=0, remain_time=? where id=?", [remain_time, nozzle.id]);
                                            } else {
                                                db.exec("update nozzle set state=0, remain_time=null where id=?", [nozzle.id]);
                                            }
                                            db.exec("update job set end_time=? where nozzle_id=? and start_time<? and end_time is null", [current_time, nozzle.id, current_time]);
                                            done();
                                        } else {
                                            db.exec("update nozzle set state=0, remain_time=null where id=?", [nozzle.id]);
                                            done();
                                        }
                                    });
                                } else {
                                    db.exec("update nozzle set state=1,use_state=1,remain_time=null where id=?", [nozzle.id]);
                                    done();
                                }
                            } else {
                                done();
                            }
                        }, function() {
                            console.log("[" + current_time + "] " + process.env.CLUB_NAME + "分控箱报告状态的指令：" + msg);
                        });
                    });
                });
            } else {
                console.log("[" + current_time + "] " + process.env.CLUB_NAME + "中控忽略本地控制指令：" + msg);
            }
        } else if (commands[0] === process.env.COMMAND_REMOTE_OR_LOCAL_CONTROL_FEEDBACK) {
            console.log("[" + current_time + "] " + process.env.CLUB_NAME + "远程或本地控制命令的反馈命令nothing to do：" + msg);  ///////////////////
        } else if (commands[0] === process.env.COMMAND_GPS) {
            var cart_no = commands[1];
            var gps = commands[2].split(",");
            var cart_lon = parseFloat(gps[0]);
            var cart_lat = parseFloat(gps[1]);
            var distance = parseInt(gps[2]) * 10 + 30;
            esClient.search({
                index: process.env.DATABASE,
                body: {
                    "query": {
                        "bool": {
                            "must": {
                                "match_all": {}
                            },
                            "filter": {
                                "geo_distance": {
                                    "distance": distance + "m",
                                    "location": {
                                        "lat": cart_lat,
                                        "lon": cart_lon
                                    }
                                }
                            }
                        }
                    }
                }
            }, (err, result) => {
                var need_pause_nozzle_ids = [];
                for(var i=0; i<result.hits.hits.length; i++) {
                    var angle = getAngleByGps(cart_lon, cart_lat, result.hits.hits[i]._source.location.lon, result.hits.hits[i]._source.location.lat)
                    if (Math.abs(parseInt(gps[3]) - angle) <= Math.atan(30 / distance) * 180 / Math.PI) {
                        need_pause_nozzle_ids.push(result.hits.hits[i]._source.nozzle_id);
                    }
                }
                need_pause_nozzle_ids = _.uniq(need_pause_nozzle_ids);
                var already_paused_nozzle_ids = [];
                for(var i=0; i<pauses.length; i++) {
                    if (pauses[i].cart_no === cart_no) {
                        already_paused_nozzle_ids.push(pauses[i].nozzle_id);
                    }
                }
                var may_restart_nozzle_ids = _.difference(already_paused_nozzle_ids, need_pause_nozzle_ids);
                var newly_need_pause_nozzle_ids = _.difference(need_pause_nozzle_ids, already_paused_nozzle_ids);
                lock.acquire('change_pause_matrix', function () {
                    pauses = pauses.filter(function (pause) {
                        if (pause.cart_no === cart_no) {
                            return may_restart_nozzle_ids.indexOf(pause.nozzle_id) === -1;
                        } else {
                            return true;
                        }
                    });
                    for(i=0; i < newly_need_pause_nozzle_ids.length; i++) {
                        pauses.push(new Pause(cart_no, newly_need_pause_nozzle_ids[i]));
                    }
                    var may_send_nozzle_ids = [];
                    for(var i=0; i<may_restart_nozzle_ids.length; i++) {
                        var may_send = true;
                        for(var j=0; j<pauses.length; j++) {
                            if (may_restart_nozzle_ids[i] === pauses[j].nozzle_id) {
                                may_send = false;
                                break;
                            }
                        }
                        if (may_send) {
                            may_send_nozzle_ids.push(may_restart_nozzle_ids[i]);
                        }
                    }
                    auto_send(may_send_nozzle_ids);
                    var may_stop_nozzle_ids = [];
                    for(var i=0; i<newly_need_pause_nozzle_ids.length; i++) {
                        var may_stop = true;
                        for(var j=0; j<pauses.length; j++) {
                            if (newly_need_pause_nozzle_ids[i] === pauses[j].nozzle_id) {
                                may_stop = false;
                                break;
                            }
                        }
                        if (may_stop) {
                            may_stop_nozzle_ids.push(newly_need_pause_nozzle_ids[i]);
                        }
                    }
                    auto_stop(may_stop_nozzle_ids);
                }, function (err, ret) {
                })
            });
        }
    } else {
        console.log("[" + current_time + "] " + process.env.CLUB_NAME + "CRC16校验错误：" + msg);
    }
});
function check_crc(message) {
    var str = message.substr(0, message.length - 4);
    var crc = message.substring(message.length - 4);
    return left_pad(crc16(str).toString(16), 4) === crc.toUpperCase();
}
/** ----------------------------------------------------------------------------- 所 有 API 的 开 始 ----------------------------------------------------------------------------------------------- **/
// 判断用户是否已登录
app.use(['/*.html', '/*.do'], function (req, res, next) {
    if (req.session.user) {
        real_name = req.session.user['real_name'];
        next();
    } else if (req.originalUrl === '/login.do') {  // 是登录操作
        next();
    } else {
        res.render('login');
    }
});
/** ----------------------------------------------------------------------------- 供 Cronicle HTTP Request 插 件 调 用 的 操 作 ----------------------------------------------------------------------------------------------- **/
// 转储2天前的job的操作
app.get("/dump_job", function (req, res) {
    var time = moment().subtract(2, 'days').format("YYYY-MM-DD HH:mm:ss");
    db.exec("insert into job_dump select * from job where start_time<=?", [time], function (results) {
        db.exec("delete from job where start_time<=?", [time], function (results) {
            if (logger.isInfoEnabled()) {
                logger.addContext('real_name', real_name);
                logger.info("每天一次，转储%s之前的job", time);
            }
            res.end("1");
        });
    });
});
// 转储3天前的plan的操作
app.get("/dump_plan", function (req, res) {
    var time = moment().subtract(3, 'days').format("YYYY-MM-DD HH:mm:ss");
    db.exec("select end_date from plan_end_date", [], function (results) {
        if (results.length === 0 || results[0].end_date === null) {
            db.exec("select id from plan where start_time<=?", [time], function (dump_plans) {
                eachAsync(dump_plans, function(dump_plan, index, done) {
                    scheduler.getEvent({
                        title: process.env.CLUB_NAME + "-plan" + dump_plan.id
                    }).then(function(data) {  // 有这个job，则删除
                        scheduler.deleteEvent({
                            id: data.event.id
                        }).then(function() {
                            db.exec("select s.id from plan p join task t on p.task_id=t.id join step s on s.task_id=t.id and p.id=? order by s.id", [dump_plan.id], function (steps) {
                                eachAsync(steps, function(step, index, done) {
                                    scheduler.getEvent({
                                        title: process.env.CLUB_NAME + "-plan" + dump_plan.id + "-step" + (index + 1)
                                    }).then(function(data) { // 有这个step job，则删除
                                        scheduler.deleteEvent({
                                            id: data.event.id
                                        }).then(function() {
                                            done();
                                        }).catch(function(err) {
                                            done();
                                        });
                                    }).catch(function(err) {
                                        done();
                                    });
                                }, function() {
                                    done();
                                });
                            });
                        }).catch(function(err) {
                            db.exec("select s.id from plan p join task t on p.task_id=t.id join step s on s.task_id=t.id and p.id=? order by s.id", [dump_plan.id], function (steps) {
                                eachAsync(steps, function(step, index, done) {
                                    scheduler.getEvent({
                                        title: process.env.CLUB_NAME + "-plan" + dump_plan.id + "-step" + (index + 1)
                                    }).then(function(data) { // 有这个step job，则删除
                                        scheduler.deleteEvent({
                                            id: data.event.id
                                        }).then(function() {
                                            done();
                                        }).catch(function(err) {
                                            done();
                                        });
                                    }).catch(function(err) {
                                        done();
                                    });
                                }, function() {
                                    done();
                                });
                            });
                        });
                    }).catch(function(err) {
                        done();
                    });
                }, function() {
                    db.exec("insert into plan_dump select * from plan where start_time<=?", [time], function (results) {
                        db.exec("delete from plan where start_time<=?", [time], function (r) {
                            if (logger.isInfoEnabled()) {
                                logger.addContext('real_name', real_name);
                                logger.info("每天一次，转储%s之前的plan", time);
                            }
                            res.end("1");
                        });
                    });
                });
            });
        } else {
            db.exec("select * from plan where start_time<=?", [time], function (dump_plans) {
                eachAsync(dump_plans, function(dump_plan, index, done) {
                    var next_time = moment(dump_plan.start_time).add(7, 'days');
                    if (next_time.isBefore(moment(results[0].end_date))) {
                        var t = next_time.format("YYYY-MM-DD HH:mm:ss");
                        db.exec("insert into plan(task_id, start_time) values(?,?)", [dump_plan.task_id, t], function (results) {
                            db.exec("select id from plan where task_id=? and start_time=?", [dump_plan.task_id, t], function (plans) {
                                scheduler.createEvent({
                                    title: process.env.CLUB_NAME + "-plan" + plans[0].id,
                                    catch_up: 1,
                                    enabled: 1,
                                    category: 'general',
                                    target: 'allgrp',
                                    algo: 'round_robin',
                                    plugin: 'urlplug',
                                    params: {
                                        method: 'post',
                                        url: 'http://' + process.env.SCHEDULED_SERVICE_ID + ":" + process.env.SCHEDULED_SERVICE_PORT + '/preprocess/' + plans[0].id,
                                        success_match: '1',
                                        error_match: '0'
                                    },
                                    retries: 3,
                                    retry_delay: 30,
                                    timing: getFutureTiming(moment(next_time).subtract(10, 'seconds')),
                                    timezone: 'Asia/Shanghai'
                                }).then(function() {
                                    done();
                                }).catch(function(err) {
                                    console.log(err.code + ":" + err.message);
                                    done(err.code + ":" + err.message);
                                });
                            });
                        });
                    } else {
                        done();
                    }
                }, function() {
                    eachAsync(dump_plans, function(dump_plan, index, done) {
                        scheduler.getEvent({
                            title: process.env.CLUB_NAME + "-plan" + dump_plan.id
                        }).then(function(data) {  // 有这个job，则删除
                            scheduler.deleteEvent({
                                id: data.event.id
                            }).then(function() {
                                db.exec("select s.id from plan p join task t on p.task_id=t.id join step s on s.task_id=t.id and p.id=? order by s.id", [dump_plan.id], function (steps) {
                                    eachAsync(steps, function(step, index, done) {
                                        scheduler.getEvent({
                                            title: process.env.CLUB_NAME + "-plan" + dump_plan.id + "-step" + (index + 1)
                                        }).then(function(data) { // 有这个step job，则删除
                                            scheduler.deleteEvent({
                                                id: data.event.id
                                            }).then(function() {
                                                done();
                                            }).catch(function(err) {
                                                done();
                                            });
                                        }).catch(function(err) {
                                            done();
                                        });
                                    }, function() {
                                        done();
                                    });
                                });
                            }).catch(function(err) {
                                db.exec("select s.id from plan p join task t on p.task_id=t.id join step s on s.task_id=t.id and p.id=? order by s.id", [dump_plan.id], function (steps) {
                                    eachAsync(steps, function(step, index, done) {
                                        scheduler.getEvent({
                                            title: process.env.CLUB_NAME + "-plan" + dump_plan.id + "-step" + (index + 1)
                                        }).then(function(data) { // 有这个step job，则删除
                                            scheduler.deleteEvent({
                                                id: data.event.id
                                            }).then(function() {
                                                done();
                                            }).catch(function(err) {
                                                done();
                                            });
                                        }).catch(function(err) {
                                            done();
                                        });
                                    }, function() {
                                        done();
                                    });
                                });
                            });
                        }).catch(function(err) {
                            done();
                        });
                    }, function() {
                        db.exec("insert into plan_dump select * from plan where start_time<=?", [time], function (results) {
                            db.exec("delete from plan where start_time<=?", [time], function (r) {
                                if (logger.isInfoEnabled()) {
                                    logger.addContext('real_name', real_name);
                                    logger.info("每天一次，转储%s之前的plan", time);
                                }
                                res.end("1");
                            });
                        });
                    });
                });
            });
        }
    });
});
// 洒水计划预处理操作
app.post("/preprocess/:plan_id", function (req, res) {
    db.exec("select p.start_time,s.how_long,s.involved_nozzle from plan p join task t on p.task_id=t.id join step s on s.task_id=t.id and p.id=? order by s.id", [req.params.plan_id], function (steps) {
        if (steps.length > 0) {
            steps[0].start_time = moment(steps[0].start_time).format("YYYY-MM-DD HH:mm:ss");
        }
        for(var i=1; i<steps.length; i++) {
            steps[i].start_time = moment(steps[i-1].start_time).clone().add(steps[i-1].how_long, "seconds").add(process.env.TASK_STEP_INTERVAL_SECONDS, "seconds").format("YYYY-MM-DD HH:mm:ss");
        }
        eachAsync(steps, function(step, index, done) {
            var step_no = index + 1;
            scheduler.getEvent({
                title: process.env.CLUB_NAME + "-plan" + req.params.plan_id + "-step" + step_no
            }).then(function(data) { // 有这个job，则删除
                scheduler.deleteEvent({
                    id: data.event.id
                }).then(function() {
                    scheduler.createEvent({
                        title: process.env.CLUB_NAME + "-plan" + req.params.plan_id + "-step" + step_no,
                        catch_up: 1,
                        enabled: 1,
                        category: 'general',
                        target: 'allgrp',
                        algo: 'round_robin',
                        plugin: 'urlplug',
                        params: {
                            method: 'post',
                            url: 'http://' + process.env.SCHEDULED_SERVICE_ID + ":" + process.env.SCHEDULED_SERVICE_PORT + '/irrigate/' + req.params.plan_id + '/' + step.involved_nozzle + '/' + step.how_long,
                            success_match: '1',
                            error_match: '0'
                        },
                        retries: 3,
                        retry_delay: 30,
                        timing: getFutureTiming(step.start_time),
                        timezone: 'Asia/Shanghai'
                    }).then(function() {
                        done();
                    }).catch(function(err) {
                        console.log(err.code + ":" + err.message);
                        done(err.code + ":" + err.message);
                    });
                }).catch(function(err) {
                    console.log(err.code + ":" + err.message);
                    done(err.code + ":" + err.message);
                });
            }).catch(function(err) {
                scheduler.createEvent({
                    title: process.env.CLUB_NAME + "-plan" + req.params.plan_id + "-step" + step_no,
                    catch_up: 1,
                    enabled: 1,
                    category: 'general',
                    target: 'allgrp',
                    algo: 'round_robin',
                    plugin: 'urlplug',
                    params: {
                        method: 'post',
                        url: 'http://' + process.env.SCHEDULED_SERVICE_ID + ":" + process.env.SCHEDULED_SERVICE_PORT + '/irrigate/' + req.params.plan_id + '/' + step.involved_nozzle + '/' + step.how_long,
                        success_match: '1',
                        error_match: '0'
                    },
                    retries: 3,
                    retry_delay: 30,
                    timing: getFutureTiming(step.start_time),
                    timezone: 'Asia/Shanghai'
                }).then(function() {
                    done();
                }).catch(function(err) {
                    console.log(err.code + ":" + err.message);
                    done(err.code + ":" + err.message);
                });
            });
        }, function(error) {
            if (error) {
                res.end("0");
            } else {
                res.end("1");
            }
        });
    });
});
// 按洒水计划规定的时间执行洒水的操作
app.post("/irrigate/:plan_id/:nozzle_ids/:howlong", function (req, res) {
    var involved_nozzles = req.params.nozzle_ids.split(',');
    var where = "";
    for(var i=0; i< involved_nozzles.length; i++) {
        where += "a.id=" + involved_nozzles[i] + " or ";
    }
    where += "1=0";
    db.exec("select a.id as nozzle_id, b.no as controlbox_no, a.no as nozzle_no, c.moisture from nozzle a join controlbox b on a.controlbox_id=b.id left join turf c on a.turf_id=c.id where a.use_state=1 and a.state=0 and (" + where + ")", [], function (results) {
        var commands = [], values = [];
        var start_time = moment().format("YYYY-MM-DD HH:mm:ss");
        for(var i=0; i<results.length; i++) {
            if (results[i].moisture === null) {
                results[i].moisture = 100;
            }
            var long = parseInt(req.params.howlong) * results[i].moisture / 100;
            commands.push(numeral(results[i].controlbox_no).format('000') + "-" + numeral(results[i].nozzle_no).format('00') + "," + left_pad(long.toString(16), 4));
            values.push("(" + req.params.plan_id + "," + results[i].nozzle_id + ",'" + results[i].controlbox_no + "-" + results[i].nozzle_no + "','" + start_time + "'," + long + ")");
        }
        var command = commands[0], value = values[0];
        for(i=1; i<commands.length; i++) {
            if (i % process.env.COMMAND_BATCH_SIZE === 0) {
                command = process.env.COMMAND_IRRIGATE + "|{}|" + command + "|";
                command = format(command, numeral(command.length + 1 + 4).format('000'));
                command = command + left_pad(crc16(command).toString(16), 4);
                mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
                    if (!err) {
                        console.log("[" + start_time + "] " + process.env.CLUB_NAME + "中控按洒水计划下发洒水指令：" + command);
                        try {
                            db.exec("insert into job(plan_id,nozzle_id,nozzle_address,start_time,how_long) values " + value, []);
                        } catch (e) {
                        }
                    } else {
                        res.end("0");
                    }
                });
                command = commands[i];
                value = values[i];
            } else {
                command += ";" + commands[i];
                value += "," + values[i];
            }
        }
        command = process.env.COMMAND_IRRIGATE + "|{}|" + command + "|";
        command = format(command, numeral(command.length + 1 + 4).format('000'));
        command = command + left_pad(crc16(command).toString(16), 4);
        mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
            if (!err) {
                console.log("[" + start_time + "] " + process.env.CLUB_NAME + "中控按洒水计划下发洒水指令：" + command);
                try {
                    db.exec("insert into job(plan_id,nozzle_id,nozzle_address,start_time,how_long) values " + value, [], function(results) {
                        res.end("1");
                    });
                } catch (e) {
                    res.end("0");
                }
            } else {
                res.end("0");
            }
        });
    });
});
function left_pad(num, n) {
    var len = num.toString().length;
    while(len < n) {
        num = "0" + num;
        len++;
    }
    return num.toUpperCase();
}
/** ---------------------------------------------------------------------- 从 AJAX 请 求，代 表 网 页 或 移 动 app，使 用 百 度 地 图 ----------------------------------------------------------------------------- **/
// 登录操作
app.post("/login.do", function (req, res) {
    db.exec("select id,name,password,real_name,can_login,can_pos,can_irrigate from user where name=? and password=?", [req.body.username, req.body.password], function (users) {
        if (users.length === 1) {  // 有这个用户
            if (users[0].can_login === 1) {  // 允许登录
                var fromIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || req.ip || req.connection.socket.remoteAddress;
                db.exec("update user set login_time=?, from_ip=? where name=? and password=?", [moment().format("YYYY-MM-DD HH:mm:ss"), fromIp, req.body.username, req.body.password], function () {
                    req.session.user = users[0];
                    real_name = req.session.user['real_name'];
                    if (logger.isInfoEnabled()) {
                        logger.addContext('real_name', real_name);
                        logger.info("%s于%s登录系统", req.body.username, moment().format("YYYY-MM-DD HH:mm:ss"));
                    }
                    var userAgent = (req.headers["user-agent"] || "").toLowerCase();
                    if (userAgent.match(/(iphone|ipod|ipad|android|nexus)/)) {  // 移动端
                        res.redirect("/gps_control.html");
                    } else {  // pc端
                        res.redirect("/dynamics.html");
                    }
                });
            } else {  // 不允许登录
                res.render("login", {fail: 200});  // 不允许登录
            }
        } else {
            res.render("login", {fail: 100});  // 用户名或密码错误
        }
    });
});
// 修改我的密码操作
app.post("/change_password.do", function (req, res) {
    db.exec("select password from user where name=?", [req.session.user.name], function (passwords) {
        if (passwords.length === 1 && passwords[0].password === req.body.old_password) {
            db.exec("update user set password=? where name=?", [req.body.password, req.session.user.name], function () {
                if (logger.isInfoEnabled()) {
                    logger.addContext('real_name', real_name);
                    logger.info("%s于%s修改密码", req.session.user.name, moment().format("YYYY-MM-DD HH:mm:ss"));
                }
                res.redirect("/logout.do");
            });
        } else {
            res.render("change_password", {fail: [0]});
        }
    });
});
// 全部停止的操作
app.post("/stop_all.do", function (req, res) {
    var command = process.env.COMMAND_STOP_ALL + "|";
    command = command + left_pad(crc16(command).toString(16), 4);
    mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
        if (!err) {
            console.log("[" + moment().format("YYYY-MM-DD HH:mm:ss") + "] " + process.env.CLUB_NAME + "中控下发全部停止指令：" + command);
            res.json({success: true});
        } else {
            res.json({failure: true});
        }
    });
});
// 手动灌溉，实时发送指令的操作
app.post("/send.do", function (req, res) {
    var howlong = parseInt(req.body.minute) * 60;  //秒
    var nozzle_ids = JSON.parse(req.body.nozzle_ids);
    var where = "";
    for(var i=0; i<nozzle_ids.length; i++) {
        where += "a.id=" + nozzle_ids[i] + " or ";
    }
    where += "1=0";
    db.exec("select a.id as nozzle_id, b.no as controlbox_no, a.no as nozzle_no, c.moisture from nozzle a join controlbox b on a.controlbox_id=b.id left join turf c on a.turf_id=c.id where a.use_state=1 and a.state=0 and (" + where + ")", [], function (results) {
        var commands = [], values = [];
        var start_time = moment().format("YYYY-MM-DD HH:mm:ss");
        for(var i=0; i<results.length; i++) {
            if (results[i].moisture === null) {
                results[i].moisture = 100;
            }
            var long = howlong * results[i].moisture / 100;
            commands.push(numeral(results[i].controlbox_no).format('000') + "-" + numeral(results[i].nozzle_no).format('00') + "," + left_pad(long.toString(16), 4));
            values.push("(" + results[i].nozzle_id + ",'" + results[i].controlbox_no + "-" + results[i].nozzle_no + "','" + start_time + "'," + long + ")");
        }
        var command = commands[0], value = values[0];
        for(i=1; i<commands.length; i++) {
            if (i % process.env.COMMAND_BATCH_SIZE === 0) {
                command = process.env.COMMAND_IRRIGATE + "|{}|" + command + "|";
                command = format(command, numeral(command.length + 1 + 4).format('000'));
                command = command + left_pad(crc16(command).toString(16), 4);
                mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
                    if (!err) {
                        console.log("[" + start_time + "] " + process.env.CLUB_NAME + "中控按手动灌溉下发洒水指令：" + command);
                        try {
                            db.exec("insert into job(nozzle_id,nozzle_address,start_time,how_long) values " + value, []);
                        } catch (e) {
                        }
                    } else {
                        res.json({failure: true});
                    }
                });
                command = commands[i];
                value = values[i];
            } else {
                command += ";" + commands[i];
                value += "," + values[i];
            }
        }
        command = process.env.COMMAND_IRRIGATE + "|{}|" + command + "|";
        command = format(command, numeral(command.length + 1 + 4).format('000'));
        command = command + left_pad(crc16(command).toString(16), 4);
        mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
            if (!err) {
                console.log("[" + start_time + "] " + process.env.CLUB_NAME + "中控按手动灌溉下发洒水指令：" + command);
                try {
                    db.exec("insert into job(nozzle_id,nozzle_address,start_time,how_long) values " + value, [], function() {
                        res.json({success: true});
                    });
                } catch (e) {
                    res.json({failure: true});
                }
            } else {
                res.json({failure: true});
            }
        });
    });
});
// 暂停分控箱灌溉的操作
app.post("/stop.do", function (req, res) {
    var controlbox_ids = JSON.parse(req.body.controlbox_ids);
    var where = "";
    for(var i=0; i<controlbox_ids.length; i++) {
        where += "id=" + controlbox_ids[i] + " or ";
    }
    where += "1=0";
    db.exec("select no from controlbox where (" + where + ")", [], function (cotrolbox_nos) {
        var s = "";
        for(var i=0; i<cotrolbox_nos.length;i++) {
            s += numeral(cotrolbox_nos[i].no).format('000') + '-99,';
        }
        if (s.length > 0) {
            s = s.substr(0, s.length - 1);
        }
        var command = process.env.COMMAND_STOP_SOME + "|";
        command += s + "|";
        command = command + left_pad(crc16(command).toString(16), 4);
        mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
            if (!err) {
                console.log("[" + moment().format("YYYY-MM-DD HH:mm:ss") + "] " + process.env.CLUB_NAME + "中控向分控箱" + s.replace(/-99/g, "") + "下发停止洒水指令：" + command);
                res.json({success: true});
            } else {
                res.json({failure: true});
            }
        });
    });
});
// 取消所有洒水计划的操作（删除Cronicle中除了dump_job以外的所有事件）
app.post("/cancel_all.do", function (req, res) {
    scheduler.getSchedule({
        limit: 9999
    }).then(function (data) {  // 取出所有job
        eachAsync(data.rows, function(plan_or_step, index, done) {
            if (plan_or_step.title.indexOf(process.env.CLUB_NAME) === 0 && plan_or_step.title !== process.env.CLUB_NAME + '-dump_job' && plan_or_step.title !== process.env.CLUB_NAME + '-dump_plan') {
                scheduler.deleteEvent({
                    id: plan_or_step.id
                }).then(function() {
                    if (logger.isDebugEnabled()) {
                        logger.addContext('real_name', real_name);
                        logger.debug("在取消所有洒水计划时，取消%s，其调度时间为%s", plan_or_step.title, plan_or_step.timing.years[0] + "-" + plan_or_step.timing.months[0] + "-" + plan_or_step.timing.days[0] + " " + plan_or_step.timing.hours[0] + ":" + plan_or_step.timing.minutes[0] + ":00");
                    }
                    done();
                }).catch(function(err) {
                    console.log(err.code + ":" + err.message);
                    done(err.code + ":" + err.message);
                });
            } else {
                done();
            }
        }, function() {
            db.exec("delete from plan", [], function (results) {
                db.exec("delete from plan_end_date", [], function (results) {
                    if (logger.isInfoEnabled()) {
                        logger.addContext('real_name', real_name);
                        logger.info("%s于%s取消所有洒水计划", req.session.user.name, moment().format("YYYY-MM-DD HH:mm:ss"));
                    }
                    res.json({success: true});
                });
            });
        });
    }).catch(function(err) {
        console.log(err.code + ":" + err.message);
        res.json({failure: true});
    });
});
// 保存洒水计划的操作
app.post("/save_plan.do", function (req, res) {
    var plan_ids = JSON.parse(req.body.plan_ids);
    var task_ids = JSON.parse(req.body.task_ids);
    var start_times = JSON.parse(req.body.start_times);
    var delExistingPlanIds = JSON.parse(req.body.delExistingPlanIds);
    var end_date = req.body.end_date;

    db.exec("delete from plan_end_date", [], function (results) {
        db.exec("insert into plan_end_date(end_date) values(?)", [end_date]);
    });

    eachAsync(plan_ids, function(plan_id, i, done) {
        if (plan_id.indexOf('-') < 0) {  // 已有该计划
            db.exec("select task_id,start_time from plan where id=?", [plan_id], function (plans) {
                if (moment(plans[0].start_time).format("YYYY-MM-DD HH:mm:ss") !== start_times[i]) {  // 如果开始时间变了，修改开始时间
                    db.exec("update plan set start_time=? where id=?", [start_times[i], plan_id], function (results) {
                        scheduler.getEvent({
                            title: process.env.CLUB_NAME + "-plan" + plan_id
                        }).then(function(data) { // 有这个job，则修改
                            scheduler.updateEvent({
                                id: data.event.id,
                                timing: getFutureTiming(moment(start_times[i]).subtract(10, 'seconds'))
                            }).then(function() {
                                if (logger.isDebugEnabled()) {
                                    logger.addContext('real_name', real_name);
                                    logger.debug("保存洒水计划%s，任务%s, 调度时间为%s", "plan" + plan_id, plans[0].task_id, start_times[i]);
                                }
                                done();
                            }).catch(function(err) {
                                console.log(err.code + ":" + err.message);
                                done(err.code + ":" + err.message);
                            });
                        }).catch(function(err) {
                            done();
                        });
                    });
                } else {
                    done();
                }
            });
        } else {  // 原先没有该计划
            db.exec("insert into plan(task_id,start_time) values(?,?)", [task_ids[i], start_times[i]], function (results) {
                db.exec("select id from plan where task_id=? and start_time=?", [task_ids[i], start_times[i]], function (plans) {
                    scheduler.createEvent({
                        title: process.env.CLUB_NAME + "-plan" + plans[0].id,
                        catch_up: 1,
                        enabled: 1,
                        category: 'general',
                        target: 'allgrp',
                        algo: 'round_robin',
                        plugin: 'urlplug',
                        params: {
                            method: 'post',
                            url: 'http://' + process.env.SCHEDULED_SERVICE_ID + ":" + process.env.SCHEDULED_SERVICE_PORT + '/preprocess/' + plans[0].id,
                            success_match: '1',
                            error_match: '0'
                        },
                        retries: 3,
                        retry_delay: 30,
                        timing: getFutureTiming(moment(start_times[i]).subtract(10, 'seconds')),
                        timezone: 'Asia/Shanghai'
                    }).then(function() {
                        if (logger.isDebugEnabled()) {
                            logger.addContext('real_name', real_name);
                            logger.debug("保存洒水计划%s，任务%s, 调度时间为%s", "plan" + plans[0].id, task_ids[i], start_times[i]);
                        }
                        done();
                    }).catch(function(err) {
                        console.log(err.code + ":" + err.message);
                        done(err.code + ":" + err.message);
                    });
                });
            });
        }
    }, function(err) {
        // 删除已有计划
        eachAsync(delExistingPlanIds, function(delExistingPlanId, i, done) {
            scheduler.getEvent({
                title: process.env.CLUB_NAME + "-plan" + delExistingPlanId
            }).then(function(data) { // 有这个job，则删除
                scheduler.deleteEvent({
                    id: data.event.id
                }).then(function() {
                    if (logger.isDebugEnabled()) {
                        logger.addContext('real_name', real_name);
                        logger.debug("取消洒水计划%s", data.event.title);
                    }
                    // 删除已有的洒水计划
                    db.exec("delete from plan where id=?", [delExistingPlanId], function () {
                        done();
                    });
                }).catch(function(err) {
                    console.log(err.code + ":" + err.message);
                    done(err.code + ":" + err.message);
                });
            }).catch(function(err) {
                done();
            });
        }, function() {
            res.json({success: true});
        });
    });
});
// 新增球场操作
app.post("/add_course.do", function (req, res) {
    db.exec("insert into course(name,hole_count) values(?,?)", [req.body.name, req.body.hole_count], function () {
        res.json({success: true});
    });
});
// 修改球场操作
app.post("/update_course.do", function (req, res) {
    db.exec("update course set name=?, hole_count=? where id=?", [req.body.name, req.body.hole_count, req.body.id], function () {
        res.json({success: true});
    });
});
// 删除球场操作
app.post("/del_course.do", function (req, res) {
    db.exec("delete from nozzle where course_id=?", [req.body.id], function () {
        db.exec("delete from course where id=?", [req.body.id], function () {
            res.json({success: true});
        });
    });
});
// 新增区域操作
app.post("/add_area.do", function (req, res) {
    db.exec("insert into area(name) values(?)", [req.body.name], function () {
        res.json({success: true});
    });
});
// 修改区域操作
app.post("/update_area.do", function (req, res) {
    db.exec("update area set name=? where id=?", [req.body.name, req.body.id], function () {
        res.json({success: true});
    });
});

// 新增分控箱操作
app.post("/add_controlbox.do", function (req, res) {
    db.exec("select id from controlbox where no=?", [req.body.no], function (ids) {
        if (ids.length > 0) {
            res.json({failure: true});  // 分控箱编号重复
        } else {
            var r = Math.floor(Math.random()*256);
            var g = Math.floor(Math.random()*256);
            var b = Math.floor(Math.random()*256);
            var color = '#' + r.toString(16) + g.toString(16) + b.toString(16);
            var lon = (req.body.lon === '')?null:req.body.lon;
            var lat = (req.body.lat === '')?null:req.body.lat;
            if (lon === null || lat === null) {
                var gcj_lon = null;
                var gcj_lat = null;
                var gps_lon = null;
                var gps_lat = null;
            } else {
                var gcj = gcoord.transform(
                    [parseFloat(lon), parseFloat(lat)],    // 经纬度坐标
                    gcoord.BD09,               // 当前坐标系
                    gcoord.GCJ02               // 目标坐标系
                );
                gcj_lon = gcj[0];
                gcj_lat = gcj[1];
                var gps = gcoord.transform(
                    [parseFloat(lon), parseFloat(lat)],    // 经纬度坐标
                    gcoord.BD09,               // 当前坐标系
                    gcoord.WGS84               // 目标坐标系
                );
                gps_lon = gps[0];
                gps_lat = gps[1];
            }
            db.exec("insert into controlbox(no,name,model_id,nozzle_count,lon,lat,gcj_lon,gcj_lat,gps_lon,gps_lat,color,last_recv_time) values(?,?,?,?,?,?,?,?,?,?,?,?)", [req.body.no, req.body.name, req.body.model_id, req.body.nozzle_count, lon, lat, gcj_lon, gcj_lat, gps_lon, gps_lat, color, moment().format("YYYY-MM-DD HH:mm:ss")], function () {
                res.json({success: true});
            });
        }
    });
});
// 修改分控箱操作
app.post("/update_controlbox.do", function (req, res) {
    var lon = (req.body.lon === '')?null:req.body.lon;
    var lat = (req.body.lat === '')?null:req.body.lat;
    if (lon === null || lat === null) {
        var gcj_lon = null;
        var gcj_lat = null;
        var gps_lon = null;
        var gps_lat = null;
    } else {
        var gcj = gcoord.transform(
            [parseFloat(lon), parseFloat(lat)],    // 经纬度坐标
            gcoord.BD09,               // 当前坐标系
            gcoord.GCJ02                 // 目标坐标系
        );
        gcj_lon = gcj[0];
        gcj_lat = gcj[1];
        var gps = gcoord.transform(
            [parseFloat(lon), parseFloat(lat)],    // 经纬度坐标
            gcoord.BD09,               // 当前坐标系
            gcoord.WGS84               // 目标坐标系
        );
        gps_lon = gps[0];
        gps_lat = gps[1];
    }
    var update_no = JSON.parse(req.body.update_no);
    if (!update_no) {
        db.exec("update controlbox set name=?,model_id=?,nozzle_count=?,lon=?,lat=?,gcj_lon=?,gcj_lat=?,gps_lon=?,gps_lat=? where id=?", [req.body.name, req.body.model_id, req.body.nozzle_count, lon, lat, gcj_lon, gcj_lat, gps_lon, gps_lat, req.body.id], function () {
            res.json({success: true});
        });
    } else {
        db.exec("select id from controlbox where no=?", [req.body.no], function (ids) {
            if (ids.length > 0) {
                res.json({failure: true});  // 分控箱编号重复
            } else {
                db.exec("update controlbox set no=?,name=?,model_id=?,nozzle_count=?,lon=?,lat=?,gcj_lon=?,gcj_lat=?,gps_lon=?,gps_lat=? where id=?", [req.body.no, req.body.name, req.body.model_id, req.body.nozzle_count, lon, lat, gcj_lon, gcj_lat, gps_lon, gps_lat, req.body.id], function () {
                    res.json({success: true});
                });
            }
        });
    }
});
// 删除分控箱操作
app.post("/del_controlbox.do", function (req, res) {
    // 将nozzle的controlbox_id=null，表示不属于任何分控箱
    db.exec("update nozzle set controlbox_id=null,color='#95a0b1' where controlbox_id=?", [req.body.id], function () {
        db.exec("delete from controlbox where id=?", [req.body.id], function () {
            res.json({success: true});
        });
    });
});
// 禁用分控箱操作
app.post("/disable_controlbox.do", function (req, res) {
    db.exec("update controlbox set use_state=0 where id=?", [req.body.id], function () {
        res.json({success: true});
    });
});
// 启用分控箱操作
app.post("/enable_controlbox.do", function (req, res) {
    db.exec("update controlbox set use_state=1 where id=?", [req.body.id], function () {
        res.json({success: true});
    });
});
// 远程控制操作
app.post("/remote_control.do", function (req, res) {
    db.exec("select no from controlbox where id=?", [req.body.id], function (results) {
        if (results.length > 0) {
            var command = process.env.COMMAND_REMOTE_OR_LOCAL_CONTROL + "|" + numeral(results[0].no).format('000') + "|1|";
            command = command + left_pad(crc16(command).toString(16), 4);
            mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
                if (!err) {
                    console.log("[" + moment().format("YYYY-MM-DD HH:mm:ss") + "] " + process.env.CLUB_NAME + "中控下发远程控制指令：" + command);
                    res.json({success: true});
                } else {
                    res.json({failure: true});
                }
            });
        } else {
            res.json({failure: true});
        }
    });
});
// 本地控制操作
app.post("/local_control.do", function (req, res) {
    db.exec("select no from controlbox where id=?", [req.body.id], function (results) {
        if (results.length > 0) {
            var command = process.env.COMMAND_REMOTE_OR_LOCAL_CONTROL + "|" + numeral(results[0].no).format('000') + "|0|";
            command = command + left_pad(crc16(command).toString(16), 4);
            mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
                if (!err) {
                    console.log("[" + moment().format("YYYY-MM-DD HH:mm:ss") + "] " + process.env.CLUB_NAME + "中控下发本地控制指令：" + command);
                    res.json({success: true});
                } else {
                    res.json({failure: true});
                }
            });
        } else {
            res.json({failure: true});
        }
    });
});
// 新增洒水站操作
app.post("/add_nozzle.do", function (req, res) {
    db.exec("select id from nozzle where controlbox_id=? and no=?", [req.body.controlbox_id, req.body.no], function (ids) {
        if (ids.length > 0) {
            res.json({failure: true});  // 洒水站编号重复
        } else {
            db.exec("insert into nozzle(controlbox_id,no,name,course_id,hole,area_id,model_id,shape_id,angle,shot_count,waterfall_rate,turf_id,state) values(?,?,?,?,?,?,?,?,?,?,?,?,0)", [req.body.controlbox_id, req.body.no, req.body.name, req.body.course_id, req.body.hole, req.body.area_id, req.body.model_id, req.body.shape_id, JSON.parse(req.body.angle), JSON.parse(req.body.shot_count), JSON.parse(req.body.waterfall_rate), req.body.turf_id], function () {
                db.exec("select id from nozzle where controlbox_id=? and no=?", [req.body.controlbox_id, req.body.no], function (ids) {
                    for(var i=0; i<parseInt(req.body.shot_count); i++) {
                        db.exec("insert into sprinkler(nozzle_id) values(?)", [ids[0].id]);
                    }
                    res.json({success: true});
                });
            });
        }
    });
});
// 修改洒水站操作
app.post("/update_nozzle.do", function (req, res) {
    db.exec("select shot_count from nozzle where id=?", [req.body.id], function (shot_count) {
        var update_no = JSON.parse(req.body.update_no);
        if (!update_no) {
            db.exec("update nozzle set name=?,course_id=?,hole=?,area_id=?,model_id=?,shape_id=?,angle=?,shot_count=?,waterfall_rate=?,turf_id=? where id=?", [req.body.name, req.body.course_id, req.body.hole, req.body.area_id, req.body.model_id, req.body.shape_id, JSON.parse(req.body.angle), JSON.parse(req.body.shot_count), JSON.parse(req.body.waterfall_rate), req.body.turf_id, req.body.id], function () {
                if (shot_count[0].shot_count !== parseInt(req.body.shot_count)) {  // 需要重新测量喷头的坐标
                    db.exec("delete from sprinkler where nozzle_id=?", [req.body.id], function () {
                        esClient.deleteByQuery({
                            index: process.env.DATABASE,
                            body: {
                                query: {
                                    bool: {
                                        filter: {
                                            term: {
                                                nozzle_id: parseInt(req.body.id)
                                            }
                                        }
                                    }
                                }
                            }
                        });
                        for(var i=0; i<parseInt(req.body.shot_count); i++) {
                            db.exec("insert into sprinkler(nozzle_id) values(?)", [req.body.id]);
                        }
                        res.json({success: true});
                    });
                } else {
                    db.exec("select id from sprinkler where nozzle_id=?", [req.body.id], function (ids) {
                        if (ids.length === 0) {
                            for(var i=0; i<parseInt(req.body.shot_count); i++) {
                                db.exec("insert into sprinkler(nozzle_id) values(?)", [req.body.id]);
                            }
                        }
                        res.json({success: true});
                    });
                }
            });
        } else {  // 修改了洒水站编号
            db.exec("select id from nozzle where controlbox_id=? and no=?", [req.body.controlbox_id, req.body.no], function (ids) {
                if (ids.length > 0) {
                    res.json({failure: true});  // 洒水站编号重复
                } else {
                    db.exec("update nozzle set controlbox_id=?,no=?,name=?,course_id=?,hole=?,area_id=?,model_id=?,shape_id=?,angle=?,shot_count=?,waterfall_rate=?,turf_id=? where id=?", [req.body.controlbox_id, req.body.no, req.body.name, req.body.course_id, req.body.hole, req.body.area_id, req.body.model_id, req.body.shape_id, JSON.parse(req.body.angle), JSON.parse(req.body.shot_count), JSON.parse(req.body.waterfall_rate), req.body.turf_id, req.body.id], function () {
                        if (shot_count[0].shot_count !== parseInt(req.body.shot_count)) {  // 需要重新测量喷头的坐标
                            db.exec("delete from sprinkler where nozzle_id=?", [req.body.id], function () {
                                esClient.deleteByQuery({
                                    index: process.env.DATABASE,
                                    body: {
                                        query: {
                                            bool: {
                                                filter: {
                                                    term: {
                                                        nozzle_id: parseInt(req.body.id)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                });
                                for(var i=0; i<parseInt(req.body.shot_count); i++) {
                                    db.exec("insert into sprinkler(nozzle_id) values(?)", [req.body.id]);
                                }
                                res.json({success: true});
                            });
                        } else {
                            db.exec("select id from sprinkler where nozzle_id=?", [req.body.id], function (ids) {
                                if (ids.length === 0) {
                                    for(var i=0; i<parseInt(req.body.shot_count); i++) {
                                        db.exec("insert into sprinkler(nozzle_id) values(?)", [req.body.id]);
                                    }
                                }
                                res.json({success: true});
                            });
                        }
                    });
                }
            });
        }
    });
});
// 分配洒水站操作
app.post("/distribute_nozzle.do", function (req, res) {
    db.exec("select shot_count from nozzle where id=?", [req.body.id], function (shot_count) {
        db.exec("select id from nozzle where controlbox_id=? and no=?", [req.body.controlbox_id, req.body.no], function (ids) {
            if (ids.length > 0) {
                res.json({failure: true});  // 洒水站编号重复
            } else {
                db.exec("update nozzle set controlbox_id=?,no=?,name=?,course_id=?,hole=?,area_id=?,model_id=?,shape_id=?,angle=?,shot_count=?,waterfall_rate=?,turf_id=? where id=?", [req.body.controlbox_id, req.body.no, req.body.name, req.body.course_id, req.body.hole, req.body.area_id, req.body.model_id, req.body.shape_id, JSON.parse(req.body.angle), JSON.parse(req.body.shot_count), JSON.parse(req.body.waterfall_rate), req.body.turf_id, req.body.id], function () {
                    db.exec("update nozzle a join controlbox b on a.controlbox_id=b.id set a.color=b.color where a.id=?", [req.body.id], function () {
                        if (shot_count[0].shot_count !== parseInt(req.body.shot_count)) {  // 需要重新测量喷头的坐标
                            db.exec("delete from sprinkler where nozzle_id=?", [req.body.id], function () {
                                esClient.deleteByQuery({
                                    index: process.env.DATABASE,
                                    body: {
                                        query: {
                                            bool: {
                                                filter: {
                                                    term: {
                                                        nozzle_id: parseInt(req.body.id)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                });
                                for(var i=0; i<parseInt(req.body.shot_count); i++) {
                                    db.exec("insert into sprinkler(nozzle_id) values(?)", [req.body.id]);
                                }
                                res.json({success: true});
                            });
                        } else {
                            db.exec("select id from sprinkler where nozzle_id=?", [req.body.id], function (ids) {
                                if (ids.length === 0) {
                                    for(var i=0; i<parseInt(req.body.shot_count); i++) {
                                        db.exec("insert into sprinkler(nozzle_id) values(?)", [req.body.id]);
                                    }
                                }
                                res.json({success: true});
                            });
                        }
                    });
                });
            }
        });
    });
});
// 删除洒水站操作
app.post("/del_nozzle.do", function (req, res) {
    db.exec("delete from nozzle where id=?", [req.body.id], function () {
        db.exec("delete from sprinkler where nozzle_id=?", [req.body.id], function () {
            esClient.deleteByQuery({
                index: process.env.DATABASE,
                body: {
                    query: {
                        bool: {
                            filter: {
                                term: {
                                    nozzle_id: parseInt(req.body.id)
                                }
                            }
                        }
                    }
                }
            });
            res.json({success: true});
        });
    });
});
// 禁用洒水站操作
app.post("/disable_nozzle.do", function (req, res) {
    db.exec("update nozzle set use_state=0 where id=?", [req.body.id], function () {
        res.json({success: true});
    });
});
// 启用洒水站操作
app.post("/enable_nozzle.do", function (req, res) {
    db.exec("update nozzle set use_state=1 where id=?", [req.body.id], function () {
        res.json({success: true});
    });
});
// 新增洒水任务操作
app.post("/add_task.do", function (req, res) {
    db.exec("select id from task where name=?", [req.body.name], function (result) {
        if (result.length > 0) {
            res.json({failure: true});
        } else {
            db.exec("insert into task(name,`desc`) values(?,?)", [req.body.name, req.body.desc], function () {
                db.exec("select id from task where name=?", [req.body.name], function (tasks) {
                    var steps = JSON.parse(req.body.step);
                    eachAsync(steps, function(step, index, done) {
                        db.exec("insert into step(task_id,how_long,involved_nozzle) values(?,?,?)", [tasks[0].id, step.s, step.n], function () {
                            done();
                        });
                    }, function() {
                        res.json({success: true});
                    });
                });
            });
        }
    });
});
// 修改洒水任务操作
app.post("/update_task.do", function (req, res) {
    db.exec("update task set name=?,`desc`=? where id=?", [req.body.name, req.body.desc, req.body.id], function () {
        db.exec("delete from step where task_id=?", [req.body.id], function () {
            var steps = JSON.parse(req.body.step);
            eachAsync(steps, function(step, index, done) {
                db.exec("insert into step(task_id,how_long,involved_nozzle) values(?,?,?)", [req.body.id, step.s, step.n], function () {
                    done();
                });
            }, function() {
                res.json({success: true});
            });
        });
    });
});
// 删除洒水任务
app.post("/del_task.do", function (req, res) {
    db.exec("select distinct(id) from plan where task_id=?", [req.body.id], function (plans) {
        eachAsync(plans, function(plan, index, done) {
            scheduler.getEvent({
                title: process.env.CLUB_NAME + "-plan" + plan.id
            }).then(function(data) { // 有这个job，则删除
                scheduler.deleteEvent({
                    id: data.event.id
                }).then(function() {
                    if (logger.isDebugEnabled()) {
                        logger.addContext('real_name', real_name);
                        logger.debug("删除洒水任务时，删除与该任务关联的洒水计划%s", data.event.title);
                    }
                    done();
                }).catch(function(err) {
                    console.log(err.code + ":" + err.message);
                    done(err.code + ":" + err.message);
                });
            }).catch(function(err) {
                done();
            });
        }, function(err) {
            db.exec("delete from plan where task_id=?", [req.body.id], function () {
                db.exec("delete from step where task_id=?", [req.body.id], function () {
                    db.exec("select name from task where id=?", [req.body.id], function (tasks) {
                        db.exec("delete from task where id=?", [req.body.id], function () {
                            if (logger.isInfoEnabled()) {
                                logger.addContext('real_name', real_name);
                                logger.info("删除洒水任务：%s", tasks[0].name);
                            }
                            res.json({success: true});
                        });
                    });
                });
            });
        });
    });
});
// 重写管网操作
app.post("/save_pipe.do", function (req, res) {
    var pipe_nodes = JSON.parse(req.body.pipe_nodes);
    var str = "";
    for(var i=0; i<pipe_nodes.length; i++) {
        var s = pipe_nodes[i].name.split(" ");
        var name = pipe_nodes[i].name, flow = "0";
        if (s.length === 2) {
            name = s[0];
            flow = s[1];
        }
        if (i === 0) {
            str += "(" + pipe_nodes[i].id + ",'" + name + "'," + pipe_nodes[i].parent_id + "," + flow + ")";
        } else {
            str += ",(" + pipe_nodes[i].id + ",'" + name + "'," + pipe_nodes[i].parent_id + "," + flow + ")";
        }
    }
    db.exec("delete from pipe", [], function () {
        db.exec("insert into pipe(id,name,parent_id,flow) values " + str, [], function () {
            db.exec("update nozzle set pipe_id=null", [], function () {
                var nozzle_nodes = JSON.parse(req.body.nozzle_nodes);
                eachAsync(nozzle_nodes, function(nozzle_node, index, done) {
                    db.exec("update nozzle set pipe_id=? where id=?", [nozzle_node.parent_id, nozzle_node.id.slice(1)], function () {
                        done();
                    });
                }, function() {
                    res.json({success: true});
                });
            });
        });
    });
});
// 保存地图操作
app.post("/save_map.do", function (req, res) {
    db.exec("update controlbox set x=null, y=null, color=null", [], function () {
        db.exec("update nozzle set x=null, y=null, color=null", [], function () {
            var controlboxes = JSON.parse(req.body.controlboxes);
            var nozzles = JSON.parse(req.body.nozzles);
            eachAsync(controlboxes, function(controlbox, index, done) {
                db.exec("update controlbox set x=?, y=?, color=? where no=?", [controlbox.x, controlbox.y, controlbox.color, controlbox.no], function () {
                    done();
                });
            }, function() {
                var x = {}, y = {}, color = {};
                for(var i=0; i<nozzles.length; i++) {
                    var no = nozzles[i].no.split("-");
                    var key = no[0] + "-" + no[1];
                    if (key in x) {
                        x[key] = x[key] + "," + nozzles[i].x;
                        y[key] = y[key] + "," + nozzles[i].y;
                    } else {
                        x[key] = nozzles[i].x;
                        y[key] = nozzles[i].y;
                        color[key] = nozzles[i].color;
                    }
                }
                eachAsync(Object.keys(x), function(key, index, done) {
                    var no = key.split("-");  // 喷头no
                    if (no[0] === '9999') {  // 洒水站没有分控箱
                        db.exec("update nozzle set x=?, y=?, color=? where id=?", [x[key], y[key], color[key], no[1]], function () {
                            done();
                        });
                    } else {
                        db.exec("update nozzle a join controlbox b on a.controlbox_id=b.id set a.x=?, a.y=?, a.color=? where b.no=? and a.no=?", [x[key], y[key], color[key], no[0], no[1]], function () {
                            done();
                        });
                    }
                }, function() {
                    res.json({success: true});
                });
            });
        });
    });
});
// 新增设备型号操作
app.post("/add_controlbox_model.do", function (req, res) {
    db.exec("insert into controlbox_model(name,max_point_count) values(?,?)", [req.body.name, req.body.max_point_count], function () {
        res.json({success: true});
    });
});
// 修改设备型号操作
app.post("/update_controlbox_model.do", function (req, res) {
    db.exec("update controlbox_model set name=?,max_point_count=? where id=?", [req.body.name, req.body.max_point_count, req.body.id], function () {
        res.json({success: true});
    });
});
// 新增喷嘴型号操作
app.post("/add_nozzle_model.do", function (req, res) {
    db.exec("insert into nozzle_model(name,radius,flow) values(?,?,?)", [req.body.name, req.body.radius, req.body.flow], function () {
        res.json({success: true});
    });
});
// 修改喷嘴型号操作
app.post("/update_nozzle_model.do", function (req, res) {
    db.exec("update nozzle_model set name=?,radius=?,flow=? where id=?", [req.body.name, req.body.radius, req.body.flow, req.body.id], function () {
        res.json({success: true});
    });
});
// 新增喷头形状操作
app.post("/add_shape.do", function (req, res) {
    db.exec("insert into nozzle_shape(name) values(?)", [req.body.name], function () {
        res.json({success: true});
    });
});
// 修改喷头形状操作
app.post("/update_shape.do", function (req, res) {
    db.exec("update nozzle_shape set name=? where id=?", [req.body.name, req.body.id], function () {
        res.json({success: true});
    });
});
// 新增湿度操作
app.post("/add_turf.do", function (req, res) {
    db.exec("insert into turf(name,moisture) values(?,?)", [req.body.name, req.body.moisture], function () {
        res.json({success: true});
    });
});
// 修改湿度操作
app.post("/update_turf.do", function (req, res) {
    db.exec("update turf set name=?, moisture=? where id=?", [req.body.name, req.body.moisture, req.body.id], function () {
        res.json({success: true});
    });
});
// 删除湿度
app.post("/del_turf.do", function (req, res) {
    // 将nozzle的turf_id=null，表示无湿度
    db.exec("update nozzle set turf_id=null where turf_id=?", [req.body.id], function () {
        db.exec("delete from turf where id=?", [req.body.id], function () {
            res.json({success: true});
        });
    });
});
// 分控箱定位
app.post("/pos.do", function (req, res) {
    var gcj = gcoord.transform(
        [parseFloat(req.body.lon), parseFloat(req.body.lat)],    // 经纬度坐标
        gcoord.BD09,               // 当前坐标系
        gcoord.GCJ02               // 目标坐标系
    );
    var gps = gcoord.transform(
        [parseFloat(req.body.lon), parseFloat(req.body.lat)],    // 经纬度坐标
        gcoord.BD09,               // 当前坐标系
        gcoord.WGS84               // 目标坐标系
    );
    db.exec("update controlbox set lon=?, lat=?, gcj_lon=?, gcj_lat=?, gps_lon=?, gps_lat=? where id=?", [req.body.lon, req.body.lat, gcj[0], gcj[1], gps[0], gps[1], req.body.id], function () {
        res.json({success: true});
    });
});
// 改变分控箱，级联洒水站
app.post("/change_controlbox.do", function (req, res) {
    db.exec("select id, no from nozzle where controlbox_id=? order by no", [req.body.id], function (nozzles) {
        var options = [];
        for(var i=0; i<nozzles.length; i++) {
            options.push({value: nozzles[i].id, text: nozzles[i].no});
        }
        res.json({success: true, options: options});
    });
});
// 改变洒水站，级联喷头
app.post("/change_nozzle.do", function (req, res) {
    db.exec("select id from sprinkler where nozzle_id=? order by id", [req.body.id], function (sprinklers) {
        var options = [];
        for(var i=0; i<sprinklers.length; i++) {
            options.push({value: sprinklers[i].id, text: i + 1});
        }
        res.json({success: true, options: options});
    });
});
// 喷头定位
app.post("/pos_sprinkler.do", function (req, res) {
    var gcj = gcoord.transform(
        [parseFloat(req.body.lon), parseFloat(req.body.lat)],    // 经纬度坐标
        gcoord.BD09,               // 当前坐标系
        gcoord.GCJ02               // 目标坐标系
    );
    var gps = gcoord.transform(
        [parseFloat(req.body.lon), parseFloat(req.body.lat)],    // 经纬度坐标
        gcoord.BD09,               // 当前坐标系
        gcoord.WGS84               // 目标坐标系
    );
    db.exec("update sprinkler set lon=?, lat=?, gcj_lon=?, gcj_lat=?, gps_lon=?, gps_lat=? where id=?", [req.body.lon, req.body.lat, gcj[0], gcj[1], gps[0], gps[1], req.body.id], function () {
        db.exec("select * from sprinkler where id=?", [req.body.id], function (sprinklers) {
            esClient.index({
                index: process.env.DATABASE,
                id: parseInt(req.body.id),
                body: {
                    nozzle_id: sprinklers[0].nozzle_id,
                    location: {
                        lat: sprinklers[0].gps_lat,
                        lon: sprinklers[0].gps_lon
                    }
                }
            });
            res.json({success: true});
        });
    });
});
/** ---------------------------------------------------------------------------- 从 微 信 小  程 序 云 函 数 请 求，使 用 腾 讯 地 图 ----------------------------------------------------------------------------------- **/
// 验证openid
app.post("/auth_openid", function (req, res) {
    db.exec("select id, name, real_name from user where openid=?", [req.query.openid], function (users) {
        if (users.length > 0) {
            db.exec("update user set login_time=?, from_ip='wxmp' where id=?", [moment().format("YYYY-MM-DD HH:mm:ss"), users[0].id], function () {
                if (logger.isInfoEnabled()) {
                    logger.addContext('real_name', users[0].real_name);
                    logger.info("%s于%s登录系统", users[0].name, moment().format("YYYY-MM-DD HH:mm:ss"));
                }
                res.json({success: true});
            });
        } else {
            res.json({failure: true});
        }
    });
});
// 初始化地图，供微信小程序使用，腾讯地图
app.post("/controlbox_pos", function (req, res) {
    db.exec("select * from user where openid=?", [req.query.openid], function (users) {
        if (users.length > 0) {
            db.exec("select * from controlbox order by id", [], function (controlboxes) {
                var adj_controlboxes = [];
                var near_controlboxes = [];
                var far_controlboxes = [];
                var nozzleNodes = [];
                var lon = parseFloat(req.query.lon);  // 人
                var lat = parseFloat(req.query.lat);  // 人
                var where = "";
                var controlbox_lon = 0, controlbox_lat = 0;
                var once = true;
                for(var i=0; i<controlboxes.length; i++) {
                    if (controlboxes[i].gcj_lon !== null) {
                        var d = distance(lon, lat, controlboxes[i].gcj_lon, controlboxes[i].gcj_lat);
                        if (d <= process.env.ADJACENT_DISTANCE) {
                            adj_controlboxes.push(controlboxes[i]);
                        } else if (d <= process.env.NEAR_DISTANCE) {
                            near_controlboxes.push(controlboxes[i]);
                        } else {
                            far_controlboxes.push(controlboxes[i]);
                        }
                        if (controlboxes[i].use_state === 1) {
                            controlboxes[i].fullname = controlboxes[i].no + "：" + controlboxes[i].name;
                        } else {
                            controlboxes[i].fullname = controlboxes[i].no + "：" + controlboxes[i].name + "[断网]";
                        }
                        nozzleNodes.push({id:controlboxes[i].id,name:controlboxes[i].fullname,parent_id:0,icon:"/img/分控箱.png",isHidden:true});
                        where += "b.id=" + controlboxes[i].id + " or ";
                        if (once) {
                            controlbox_lon = controlboxes[i].gcj_lon;
                            controlbox_lat = controlboxes[i].gcj_lat;
                            once = false;
                        }
                        if (req.query.id === "" + controlboxes[i].id) {
                            controlbox_lon = controlboxes[i].gcj_lon;
                            controlbox_lat = controlboxes[i].gcj_lat;
                        }
                    }
                }
                where += "1=0";
                db.exec("select a.*,b.no as controlbox_no from nozzle a join controlbox b on a.controlbox_id=b.id where (" + where + ") order by b.no, a.no", [], function (nozzles) {
                    for(var i=0; i<nozzles.length; i++) {
                        var str = "";
                        if (nozzles[i].use_state === 0) {
                            str = "[正在维修]";
                        } else {
                            if (nozzles[i].state === 1) {
                                str = "[正在洒水]";
                            }
                        }
                        var str2 = '';
                        if (nozzles[i].remain_time !== null) {
                            str2 = "(提前" + Math.round(nozzles[i].remain_time / 60) + "分钟暂停)";
                        }
                        nozzleNodes.push({id:"t" + nozzles[i].id,name:nozzles[i].controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name + str + str2,parent_id:nozzles[i].controlbox_id,icon:"/img/喷头.png"});
                    }
                    res.end(JSON.stringify({
                        controlboxes: controlboxes,
                        adj_controlboxes: adj_controlboxes,
                        near_controlboxes: near_controlboxes,
                        far_controlboxes: far_controlboxes,
                        nozzleNodes: nozzleNodes,
                        lon: lon,
                        lat: lat,
                        controlbox_lon: controlbox_lon,
                        controlbox_lat: controlbox_lat,
                        can_pos: users[0].can_pos,
                        can_irrigate: users[0].can_irrigate
                    }));
                });
            });
        } else {
            res.json({failure: true});
        }
    });
});
// 分控箱定位
app.post("/pos", function (req, res) {
    db.exec("select id from user where openid=?", [req.body.openid], function (ids) {
        if (ids.length > 0) {
            var baidu = gcoord.transform(
                [parseFloat(req.body.lon), parseFloat(req.body.lat)],    // 经纬度坐标
                gcoord.GCJ02,               // 当前坐标系
                gcoord.BD09                 // 目标坐标系
            );
            var gps = gcoord.transform(
                [parseFloat(req.body.lon), parseFloat(req.body.lat)],    // 经纬度坐标
                gcoord.GCJ02,               // 当前坐标系
                gcoord.WGS84                 // 目标坐标系
            );
            db.exec("update controlbox set lon=?, lat=?, gcj_lon=?, gcj_lat=?, gps_lon=?, gps_lat=? where id=?", [baidu[0], baidu[1], req.body.lon, req.body.lat, gps[0], gps[1], req.body.id], function () {
                res.json({success: true});
            });
        } else {
            res.json({failure: true});
        }
    });
});
// 改变分控箱，级联洒水站
app.post("/change_controlbox", function (req, res) {
    db.exec("select id from user where openid=?", [req.body.openid], function (ids) {
        if (ids.length > 0) {
            db.exec("select id, no from nozzle where controlbox_id=? order by no", [req.body.id], function (nozzles) {
                var ns = [];
                for(var i=0; i<nozzles.length; i++) {
                    ns.push({id: nozzles[i].id, no: nozzles[i].no});
                }
                res.json({success: true, nozzles: ns});
            });
        } else {
            res.json({failure: true});
        }
    });
});
// 改变洒水站，级联喷头
app.post("/change_nozzle", function (req, res) {
    db.exec("select id from user where openid=?", [req.body.openid], function (ids) {
        if (ids.length > 0) {
            db.exec("select id from sprinkler where nozzle_id=? order by id", [req.body.id], function (sprinklers) {
                var sprs = [];
                for(var i=0; i<sprinklers.length; i++) {
                    sprs.push({id: sprinklers[i].id, no: i + 1});
                }
                res.json({success: true, sprinklers: sprs});
            });
        } else {
            res.json({failure: true});
        }
    });
});
// 喷头定位
app.post("/pos_sprinkler", function (req, res) {
    db.exec("select id from user where openid=?", [req.body.openid], function (ids) {
        if (ids.length > 0) {
            var baidu = gcoord.transform(
                [parseFloat(req.body.lon), parseFloat(req.body.lat)],    // 经纬度坐标
                gcoord.GCJ02,               // 当前坐标系
                gcoord.BD09                 // 目标坐标系
            );
            var gps = gcoord.transform(
                [parseFloat(req.body.lon), parseFloat(req.body.lat)],    // 经纬度坐标
                gcoord.GCJ02,               // 当前坐标系
                gcoord.WGS84                 // 目标坐标系
            );
            db.exec("update sprinkler set lon=?, lat=?, gcj_lon=?, gcj_lat=?, gps_lon=?, gps_lat=? where id=?", [baidu[0], baidu[1], req.body.lon, req.body.lat, gps[0], gps[1], req.body.id], function () {
                db.exec("select * from sprinkler where id=?", [req.body.id], function (sprinklers) {
                    esClient.index({
                        index: process.env.DATABASE,
                        id: parseInt(req.body.id),
                        body: {
                            nozzle_id: sprinklers[0].nozzle_id,
                            location: {
                                lat: sprinklers[0].gps_lat,
                                lon: sprinklers[0].gps_lon
                            }
                        }
                    });
                    res.json({success: true});
                });
            });
        } else {
            res.json({failure: true});
        }
    });
});
// 全部停止的操作
app.post("/stop_all", function (req, res) {
    db.exec("select id from user where openid=?", [req.query.openid], function (ids) {
        if (ids.length > 0) {
            var command = process.env.COMMAND_STOP_ALL + "|";
            command = command + left_pad(crc16(command).toString(16), 4);
            mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
                if (!err) {
                    console.log("[" + moment().format("YYYY-MM-DD HH:mm:ss") + "] " + process.env.CLUB_NAME + "中控下发全部停止指令：" + command);
                    res.json({success: true});
                } else {
                    res.json({failure: true});
                }
            });
        } else {
            res.json({failure: true});
        }
    });
});
// 手动灌溉，实时发送指令的操作
app.post("/send", function (req, res) {
    db.exec("select id from user where openid=?", [req.body.openid], function (ids) {
        if (ids.length > 0) {
            var howlong = parseInt(req.body.minute) * 60;  //秒
            var nozzle_ids = JSON.parse(req.body.nozzle_ids);
            var where = "";
            for(var i=0; i<nozzle_ids.length; i++) {
                where += "a.id=" + nozzle_ids[i] + " or ";
            }
            where += "1=0";
            db.exec("select a.id as nozzle_id, b.no as controlbox_no, a.no as nozzle_no, c.moisture from nozzle a join controlbox b on a.controlbox_id=b.id left join turf c on a.turf_id=c.id where a.use_state=1 and a.state=0 and (" + where + ")", [], function (results) {
                var commands = [], values = [];
                var start_time = moment().format("YYYY-MM-DD HH:mm:ss");
                for(var i=0; i<results.length; i++) {
                    if (results[i].moisture === null) {
                        results[i].moisture = 100;
                    }
                    var long = howlong * results[i].moisture / 100;
                    commands.push(numeral(results[i].controlbox_no).format('000') + "-" + numeral(results[i].nozzle_no).format('00') + "," + left_pad(long.toString(16), 4));
                    values.push("(" + results[i].nozzle_id + ",'" + results[i].controlbox_no + "-" + results[i].nozzle_no + "','" + start_time + "'," + long + ")");
                }
                var command = commands[0], value = values[0];
                for(i=1; i<commands.length; i++) {
                    if (i % process.env.COMMAND_BATCH_SIZE === 0) {
                        command = process.env.COMMAND_IRRIGATE + "|{}|" + command + "|";
                        command = format(command, numeral(command.length + 1 + 4).format('000'));
                        command = command + left_pad(crc16(command).toString(16), 4);
                        mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
                            if (!err) {
                                console.log("[" + start_time + "] " + process.env.CLUB_NAME + "中控按手动灌溉下发洒水指令：" + command);
                                try {
                                    db.exec("insert into job(nozzle_id,nozzle_address,start_time,how_long) values " + value, []);
                                } catch (e) {
                                }
                            } else {
                                res.json({failure: true});
                            }
                        });
                        command = commands[i];
                        value = values[i];
                    } else {
                        command += ";" + commands[i];
                        value += "," + values[i];
                    }
                }
                command = process.env.COMMAND_IRRIGATE + "|{}|" + command + "|";
                command = format(command, numeral(command.length + 1 + 4).format('000'));
                command = command + left_pad(crc16(command).toString(16), 4);
                mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
                    if (!err) {
                        console.log("[" + start_time + "] " + process.env.CLUB_NAME + "中控按手动灌溉下发洒水指令：" + command);
                        try {
                            db.exec("insert into job(nozzle_id,nozzle_address,start_time,how_long) values " + value, [], function() {
                                res.json({success: true});
                            });
                        } catch (e) {
                            res.json({failure: true});
                        }
                    } else {
                        res.json({failure: true});
                    }
                });
            });
        } else {
            res.json({failure: true});
        }
    });
});
// 暂停分控箱灌溉的操作
app.post("/stop", function (req, res) {
    db.exec("select id from user where openid=?", [req.body.openid], function (ids) {
        if (ids.length > 0) {
            var controlbox_ids = JSON.parse(req.body.controlbox_ids);
            var where = "";
            for(var i=0; i<controlbox_ids.length; i++) {
                where += "id=" + controlbox_ids[i] + " or ";
            }
            where += "1=0";
            db.exec("select no from controlbox where (" + where + ")", [], function (cotrolbox_nos) {
                var s = "";
                for(var i=0; i<cotrolbox_nos.length;i++) {
                    s += numeral(cotrolbox_nos[i].no).format('000') + '-99,';
                }
                if (s.length > 0) {
                    s = s.substr(0, s.length - 1);
                }
                var command = process.env.COMMAND_STOP_SOME + "|";
                command += s + "|";
                command = command + left_pad(crc16(command).toString(16), 4);
                mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: qos}, function (err) {
                    if (!err) {
                        console.log("[" + moment().format("YYYY-MM-DD HH:mm:ss") + "] " + process.env.CLUB_NAME + "中控向分控箱" + s.replace(/-99/g, "") + "下发停止洒水指令：" + command);
                        res.json({success: true});
                    } else {
                        res.json({failure: true});
                    }
                });
            });
        } else {
            res.json({failure: true});
        }
    });
});
// 退出系统
app.post("/logout", function (req, res) {
    db.exec("select id from user where openid=?", [req.query.openid], function (ids) {
        if (ids.length > 0) {
            db.exec("update user set logout_time=? where openid=?", [moment().format("YYYY-MM-DD HH:mm:ss"), req.query.openid], function () {
                res.json({success: true});
            });
        } else {
            res.json({failure: true});
        }
    });
});
/** --------------------------------------------------------------------------- 从 网 页 或 移 动 app 请 求，使 用 百 度 地 图 -------------------------------------------------------------------------------------- **/
// 打开登录页面，也是index首页
app.get("/", function (req, res) {
    res.render('login');
});
app.get("/index.html", function (req, res) {
    res.render('login');
});
app.get("/login.html", function (req, res) {
    res.render('login');
});
// 退出系统
app.get("/logout.do", function (req, res) {
    db.exec("update user set logout_time=? where name=?", [moment().format("YYYY-MM-DD HH:mm:ss"), req.session.user.name], function () {
        req.session.destroy(function (err) {
            if (err) {
                throw err;
            } else {
                res.render('login');
            }
        });
    });
});
// 打开修改密码页面
app.get("/change_password.html", function (req, res) {
    res.render("change_password");
});
// 打开球场动态页面
app.get("/dynamics.html", function (req, res) {
    db.exec("select * from course order by id", [], function (courses) {
        var first_course_id = -1;
        if (courses.length > 0) {
            first_course_id = courses[0].id;
        }
        res.render('dynamics', {
            courses: courses,
            first_course_id: first_course_id,
            user: req.session.user,
            can_irrigate: req.session.user['can_irrigate']
        });
    });
});
// 打开球场动态子页面
app.get("/dynamics_detail.html", function (req, res) {
    var start_of_day = moment().startOf("day").format("YYYY-MM-DD HH:mm:ss");
    db.exec("select distinct(area_id) from nozzle a join job b on a.id=b.nozzle_id where a.course_id=? and b.start_time>=?", [req.query.course_id, start_of_day], function (area_ids) {
        var where = "";
        for(var i=0; i< area_ids.length; i++) {
            where += "id=" + area_ids[i].area_id + " or ";
        }
        where += "1=0";
        db.exec("select * from area where (" + where + ") order by id", [], function (areas) {
            var rows = [];
            eachAsync(areas, function(area, index, done) {
                var areaRow = {id:area.id,name:area.name,parent_id:0,icon:"/img/区域.png",type:"area",rows:[]};
                rows.push(areaRow);
                var area_auto_run = 0, area_auto_end = 0, area_manual_run = 0, area_manual_end = 0;
                db.exec("select distinct(hole) from nozzle a join job b on a.id=b.nozzle_id where a.course_id=? and a.area_id=? and b.start_time>=? order by hole", [req.query.course_id, area.id, start_of_day], function (holes) {
                    eachAsync(holes, function(hole, index, done) {
                        // 只考虑end_time，不考虑state的作用，因为一个洒水站同一天有可能执行多次任务
                        db.exec("select count(a.id) as count from job a join nozzle b on a.nozzle_id=b.id where b.course_id=? and b.area_id=? and b.hole=? and a.plan_id is not null and a.end_time is null and b.state=1 and a.start_time>=?", [req.query.course_id, area.id, hole.hole, start_of_day], function (results) {
                            var auto_run = results[0].count;  // 自动+运行中
                            db.exec("select count(a.id) as count from job a join nozzle b on a.nozzle_id=b.id where b.course_id=? and b.area_id=? and b.hole=? and a.plan_id is not null and a.end_time is not null and a.start_time>=?", [req.query.course_id, area.id, hole.hole, start_of_day], function (results) {
                                var auto_end = results[0].count;  // 自动+已完成
                                db.exec("select count(a.id) as count from job a join nozzle b on a.nozzle_id=b.id where b.course_id=? and b.area_id=? and b.hole=? and a.plan_id is null and a.end_time is null and b.state=1 and a.start_time>=?", [req.query.course_id, area.id, hole.hole, start_of_day], function (results) {
                                    var manual_run = results[0].count;  // 手动+运行中
                                    db.exec("select count(a.id) as count from job a join nozzle b on a.nozzle_id=b.id where b.course_id=? and b.area_id=? and b.hole=? and a.plan_id is null and a.end_time is not null and a.start_time>=?", [req.query.course_id, area.id, hole.hole, start_of_day], function (results) {
                                        var manual_end = results[0].count;  // 手动+已完成
                                        var holeRow = {id:area.id + "-" + hole.hole,name:hole.hole + "洞",parent_id:area.id,icon:"/img/球洞.png",auto_run:auto_run,auto_end:auto_end,manual_run:manual_run,manual_end:manual_end,type:"hole",rows:[]};
                                        areaRow.rows.push(holeRow);
                                        area_auto_run += auto_run;
                                        area_auto_end += auto_end;
                                        area_manual_run += manual_run;
                                        area_manual_end += manual_end;
                                        db.exec("select a.*,b.no as controlbox_no,c.start_time,c.plan_id,c.how_long,c.end_time from nozzle a left join controlbox b on a.controlbox_id=b.id join job c on c.nozzle_id=a.id where a.course_id=? and a.area_id=? and a.hole=? and c.start_time>=?", [req.query.course_id, area.id, hole.hole, start_of_day], function (nozzles) {
                                            for(var i=0; i<nozzles.length; i++) {
                                                if (nozzles[i].end_time === null && nozzles[i].state === 1) {
                                                    nozzles[i].end_time = moment(nozzles[i].start_time).add(nozzles[i].how_long, 'seconds').format("YYYY-MM-DD HH:mm:ss");
                                                    nozzles[i].end = false;
                                                } else {
                                                    nozzles[i].end_time = moment(nozzles[i].end_time).format("YYYY-MM-DD HH:mm:ss");
                                                    nozzles[i].end = true;
                                                }
                                            }
                                            nozzles = _.sortBy(nozzles, ['controlbox_no', 'no', 'end_time']);
                                            for(var i=0; i<nozzles.length; i++) {
                                                var manual_end = 0, auto_end = 0;
                                                if (nozzles[i].plan_id === null) {  // 手动
                                                    manual_end = moment().diff(moment(nozzles[i].start_time), 'second') / nozzles[i].how_long * 100;
                                                    if (manual_end > 100 || nozzles[i].end) {
                                                        manual_end = 100;
                                                    }
                                                } else {  // 自动
                                                    auto_end = moment().diff(moment(nozzles[i].start_time), 'second') / nozzles[i].how_long * 100;
                                                    if (auto_end > 100 || nozzles[i].end) {
                                                        auto_end = 100;
                                                    }
                                                }
                                                var controlbox_no = "无分控箱";
                                                if (nozzles[i].controlbox_no !== null) {
                                                    controlbox_no = nozzles[i].controlbox_no;
                                                }
                                                holeRow.rows.push({id:"t" + nozzles[i].id,name:controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name,parent_id:nozzles[i].area_id + "-" + nozzles[i].hole,icon:"/img/喷头.png",type:"nozzle",end_time:nozzles[i].end_time,auto_run:0,auto_end:Math.round(auto_end),manual_run:0,manual_end:Math.round(manual_end)});
                                                if (holeRow.end_time) {
                                                    if(nozzles[i].end_time > holeRow.end_time) {
                                                        holeRow.end_time = nozzles[i].end_time;
                                                    }
                                                } else {
                                                    holeRow.end_time = nozzles[i].end_time;
                                                }
                                            }
                                            if (areaRow.end_time) {
                                                if(holeRow.end_time > areaRow.end_time) {
                                                    areaRow.end_time = holeRow.end_time;
                                                }
                                            } else {
                                                areaRow.end_time = holeRow.end_time;
                                            }
                                            done();
                                        });
                                    });
                                });
                            });
                        });
                    }, function() {
                        areaRow.auto_run = area_auto_run;
                        areaRow.auto_end = area_auto_end;
                        areaRow.manual_run = area_manual_run;
                        areaRow.manual_end = area_manual_end;
                        done();
                    });
                });
            }, function() {
                var finalRows = [];
                for(var i=0; i<rows.length; i++) {
                    finalRows.push(rows[i]);
                    for(var j=0; j<rows[i].rows.length; j++) {
                        finalRows.push(rows[i].rows[j]);
                        finalRows = finalRows.concat(rows[i].rows[j].rows);
                    }
                }
                db.exec("select * from controlbox order by no", [], function (controlboxes) {
                    var nozzleNodes = [];
                    for(var i=0; i<controlboxes.length;i++) {
                        nozzleNodes.push({id:"c" + controlboxes[i].no,name:controlboxes[i].no + ":" + controlboxes[i].name,parent_id:0,x:(controlboxes[i].x === null)?-1:controlboxes[i].x,y:(controlboxes[i].y === null)?-1:controlboxes[i].y,color:(controlboxes[i].color === null)?"":controlboxes[i].color,state:0});
                    }
                    db.exec("select a.*,b.no as controlbox_no from nozzle a left join controlbox b on a.controlbox_id=b.id order by b.no, a.no", [], function (nozzles) {
                        for(var i=0; i<nozzles.length;i++) {
                            var controlbox_no = "无分控箱";
                            if (nozzles[i].controlbox_no !== null) {
                                controlbox_no = nozzles[i].controlbox_no;
                            }
                            nozzleNodes.push({id:"nc" + controlbox_no + "-" + nozzles[i].no,name:controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name,parent_id:"c" + controlbox_no,x:(nozzles[i].x === null)?-1:nozzles[i].x,y:(nozzles[i].y === null)?-1:nozzles[i].y,color:(nozzles[i].color === null)?"":nozzles[i].color,state:nozzles[i].state});
                        }
                        res.render('dynamics_detail', {
                            rows: finalRows,
                            nozzleNodes: nozzleNodes,
                            width: map_width,
                            height: map_height,
                            user: req.session.user
                        });
                    });
                });
            });
        });
    });
});
// 打开手动灌溉页面
app.get("/manual.html", function (req, res) {
    db.exec("select * from course order by id", [], function (courses) {
        var first_course_id = -1;
        if (courses.length > 0) {
            first_course_id = courses[0].id;
        }
        res.render('manual', {
            courses: courses,
            first_course_id: first_course_id,
            user: req.session.user
        });
    });
});
// 打开手动灌溉按分控箱选洒水站页面
app.get("/manual_controlbox.html", function (req, res) {
    db.exec("select distinct(controlbox_id) from nozzle where course_id=?", [req.query.course_id], function (controlbox_ids) {
        var where = "";
        for(var i=0; i< controlbox_ids.length; i++) {
            where += "id=" + controlbox_ids[i].controlbox_id + " or ";
        }
        where += "1=0";
        db.exec("select * from controlbox where (" + where + ") order by no", [], function (controlboxes) {
            var nozzleNodes = [];
            for(var i=0; i<controlboxes.length; i++) {
                nozzleNodes.push({id:controlboxes[i].id,name:controlboxes[i].no + "：" + controlboxes[i].name,parent_id:0,icon:"/img/分控箱.png"});
            }
            db.exec("select a.*,b.no as controlbox_no from nozzle a join controlbox b on a.controlbox_id=b.id where a.course_id=? order by b.no, a.no", [req.query.course_id], function (nozzles) {
                for(var i=0; i<nozzles.length; i++) {
                    var str = "";
                    if (nozzles[i].use_state === 0) {
                        str = "[正在维修]";
                    } else {
                        if (nozzles[i].state === 1) {
                            str = "[正在洒水]";
                        }
                    }
                    var str2 = '';
                    if (nozzles[i].remain_time !== null) {
                        str2 = "(提前" + Math.round(nozzles[i].remain_time / 60) + "分钟暂停)";
                    }
                    nozzleNodes.push({id:"t" + nozzles[i].id,name:nozzles[i].controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name + str + str2,parent_id:nozzles[i].controlbox_id,icon:"/img/喷头.png"});
                }
                res.render('manual_controlbox', {
                    nozzleNodes: nozzleNodes
                });
            });
        });
    });
});
// 打开手动灌溉按区域选洒水站页面
app.get("/manual_area.html", function (req, res) {
    db.exec("select distinct(area_id) from nozzle where course_id=?", [req.query.course_id], function (area_ids) {
        var where = "";
        for(var i=0; i< area_ids.length; i++) {
            where += "id=" + area_ids[i].area_id + " or ";
        }
        where += "1=0";
        db.exec("select * from area where (" + where + ") order by id", [], function (areas) {
            var nozzleNodes = [];
            for(var i=0; i<areas.length; i++) {
                nozzleNodes.push({id:areas[i].id,name:areas[i].name,parent_id:0,icon:"/img/区域.png"});
            }
            eachAsync(area_ids, function(area_id, index, done) {
                db.exec("select distinct(hole) from nozzle where course_id=? and area_id=? order by hole", [req.query.course_id, area_id.area_id], function (holes) {
                    for(var i=0; i<holes.length; i++) {
                        nozzleNodes.push({id:area_id.area_id + "-" + holes[i].hole,name:holes[i].hole + "洞",parent_id:area_id.area_id,icon:"/img/球洞.png"});
                    }
                    done();
                });
            }, function() {
                db.exec("select a.*,b.no as controlbox_no from nozzle a join controlbox b on a.controlbox_id=b.id where a.course_id=? order by b.no, a.no", [req.query.course_id], function (nozzles) {
                    for(var i=0; i<nozzles.length; i++) {
                        var str = "";
                        if (nozzles[i].use_state === 0) {
                            str = "[正在维修]";
                        } else {
                            if (nozzles[i].state === 1) {
                                str = "[正在洒水]";
                            }
                        }
                        var str2 = '';
                        if (nozzles[i].remain_time !== null) {
                            str2 = "(提前" + Math.round(nozzles[i].remain_time / 60) + "分钟暂停)";
                        }
                        nozzleNodes.push({id:"t" + nozzles[i].id,name:nozzles[i].controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name + str + str2,parent_id:nozzles[i].area_id + "-" + nozzles[i].hole,icon:"/img/喷头.png"});
                    }
                    res.render('manual_area', {
                        nozzleNodes: nozzleNodes
                    });
                });
            });
        });
    });
});
const colors = ['red-bg', 'green-bg', 'blue-bg', 'yellow-bg', 'pink-bg', 'purple-bg', 'brown-bg', 'teal-bg', 'dark-green-bg', 'fb-bg', 'tw-bg', 'orange-bg'];
const colors2 = ['#E84234', '#32ab52', '#4286F7', '#F9BB06', '#F782AA', '#6a55c2', '#ab7967', '#47BCC7', '#007368', '#3B5998', '#55ACEE', '#FF7B00'];
// 打开洒水计划页面
app.get("/plan.html", function (req, res) {
    // 取洒水任务
    db.exec("select t.id,t.name,sum(s.how_long) as how_long,count(s.id) as c from task t join step s on t.id=s.task_id group by t.id order by id", [], function (tasks) {
        var last_index = -1;
        for (var i = 0; i < tasks.length; i++) {
            var index = parseInt(Math.random() * colors.length);
            while(index === last_index) {
                index = parseInt(Math.random() * colors.length);
            }
            tasks[i]["bg-color"] = colors[index];
            last_index = index;
            tasks[i].how_long += (tasks[i].c - 1) * process.env.TASK_STEP_INTERVAL_SECONDS;
        }
        // 取洒水计划
        db.exec("select p.id,p.task_id,p.start_time,t.name,sum(s.how_long) as how_long,count(s.id) as c from plan p join task t on p.task_id=t.id join step s on t.id=s.task_id and p.start_time>=? group by p.id order by p.id", [moment().format("YYYY-MM-DD HH:mm:ss")], function (plans) {
            for (var i = 0; i < plans.length; i++) {
                plans[i].how_long += (plans[i].c - 1) * process.env.TASK_STEP_INTERVAL_SECONDS;
                for (var j = 0; j < tasks.length; j++) {
                    if (plans[i].task_id === tasks[j].id) {
                        plans[i]['bg-color'] = tasks[j]['bg-color'];
                        break;
                    }
                }
            }
            db.exec("select end_date from plan_end_date", [], function (results) {
                if (results.length > 0) {
                    res.render('plan', {
                        tasks: tasks,
                        plans: plans,
                        end_date: {
                            value: results[0].end_date
                        },
                        user: req.session.user
                    });
                } else {
                    res.render('plan', {
                        tasks: tasks,
                        plans: plans,
                        end_date: {
                            value: ''
                        },
                        user: req.session.user
                    });
                }
            });
        });
    });
});
// 打开球场设置页面
app.get("/course.html", function (req, res) {
    db.exec("select * from course where id<>0 order by id", [], function (courses) {
        res.render('course', {
            courses: courses,
            user: req.session.user,
            can_irrigate: req.session.user['can_irrigate']
        });
    });
});
// 打开区域设置子页面
app.get("/area.html", function (req, res) {
    db.exec("select * from area order by id", [], function (areas) {
        res.render('area', {
            areas: areas,
            user: req.session.user
        });
    });
});
// 打开控制系统页面
app.get("/controlbox.html", function (req, res) {
    db.exec("select a.*,b.name as controlbox_model from controlbox a join controlbox_model b on a.model_id=b.id order by a.no", [], function (controlboxes) {
        db.exec("select * from controlbox_model", [], function (controlbox_models) {
            res.render('controlbox', {
                controlboxes: controlboxes,
                controlbox_models: controlbox_models,
                user: req.session.user,
                can_pos: req.session.user['can_pos'],
                can_irrigate: req.session.user['can_irrigate']
            });
        });
    });
});
// 打开洒水站子页面
app.get("/nozzle.html", function (req, res) {
    var controlbox_id = JSON.parse(req.query.controlbox_id);
    var controlbox_no = JSON.parse(req.query.controlbox_no);
    var sql = "select name from controlbox where id=" + controlbox_id;
    if (controlbox_id === null) {
        sql = "select name from controlbox where 1=0";
    }
    db.exec(sql, [], function (controlbox_names) {
        var controlbox_name = "";
        if (controlbox_names.length > 0) {
            controlbox_name = controlbox_names[0].name;
        }
        db.exec("select id,no,name from controlbox order by no", [], function (controlboxes) {
            db.exec("select * from course order by id", [], function (courses) {
                db.exec("select * from area order by id", [], function (areas) {
                    db.exec("select id, name from nozzle_model order by id", [], function (models) {
                        db.exec("select * from nozzle_shape order by id", [], function (shapes) {
                            db.exec("select * from turf order by id", [], function (turfs) {
                                sql = "select a.*,b.name as course_name,c.name as area_name,d.name as nozzle_model,e.name as nozzle_shape,f.name as nozzle_turf,f.moisture as moisture from nozzle a join course b on a.course_id=b.id join area c on a.area_id=c.id join nozzle_model d on a.model_id=d.id join nozzle_shape e on a.shape_id=e.id left join turf f on a.turf_id=f.id where a.controlbox_id=" + controlbox_id + " order by a.no";
                                if (controlbox_id === null) {
                                    sql = "select a.*,b.name as course_name,c.name as area_name,d.name as nozzle_model,e.name as nozzle_shape,f.name as nozzle_turf,f.moisture as moisture from nozzle a join course b on a.course_id=b.id join area c on a.area_id=c.id join nozzle_model d on a.model_id=d.id join nozzle_shape e on a.shape_id=e.id left join turf f on a.turf_id=f.id where a.controlbox_id is null order by a.no";
                                }
                                db.exec(sql, [], function (nozzles) {
                                    for(var i=0; i<nozzles.length; i++) {
                                        if (nozzles[i].moisture === null) {
                                            nozzles[i].moisture = "";
                                        }
                                    }
                                    res.render('nozzle', {
                                        controlboxes: controlboxes,
                                        courses: courses,
                                        areas: areas,
                                        models: models,
                                        shapes: shapes,
                                        turfs: turfs,
                                        controlbox_id: (controlbox_id === null)?"":controlbox_id,
                                        controlbox_no: (controlbox_no === null)?"":controlbox_no,
                                        controlbox_name: controlbox_name,
                                        nozzles: nozzles,
                                        user: req.session.user
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});
// 打开洒水任务页面
app.get("/task.html", function (req, res) {
    var focus = -1;
    if (req.query.focus) {
        focus = parseInt(req.query.focus);
    }
    db.exec("select * from task order by id", [], function (tasks) {
        res.render('task', {
            tasks: tasks,
            focus: focus,
            user: req.session.user,
            can_irrigate: req.session.user['can_irrigate']
        });
    });
});
// 打开洒水步骤子页面
app.get("/task_step.html", function (req, res) {
    db.exec("select * from step where task_id=" + JSON.parse(req.query.task_id), [], function (steps) {
        var last_index = -1;
        for (var i = 0; i < steps.length; i++) {
            steps[i].minute = steps[i].how_long / 60;
            var index = parseInt(Math.random() * colors.length);
            while(index === last_index) {
                index = parseInt(Math.random() * colors.length);
            }
            steps[i]["icon-color"] = colors[index];
            steps[i]["bg-color"] = colors2[index];
            steps[i].involved_nozzle = steps[i].involved_nozzle.split(",");
            last_index = index;
        }
        db.exec("select distinct(course_id) from nozzle", [], function (course_ids) {
            var where = "";
            for(var i=0; i< course_ids.length; i++) {
                where += "id=" + course_ids[i].course_id + " or ";
            }
            where += "1=0";
            db.exec("select * from course where (" + where + ") order by id", [], function (courses) {
                var nozzleNodes = [];
                for(var i=0; i<courses.length; i++) {
                    nozzleNodes.push({id:courses[i].id,name:courses[i].name,parent_id:-1,icon:"/img/球场.png"});
                }
                eachAsync(course_ids, function(course_id, index, done) {
                    db.exec("select distinct(area_id) from nozzle where course_id=?", [course_id.course_id], function (area_ids) {
                        var where = "";
                        for(var i=0; i< area_ids.length; i++) {
                            where += "id=" + area_ids[i].area_id + " or ";
                        }
                        where += "1=0";
                        db.exec("select * from area where (" + where + ") order by id", [], function (areas) {
                            for(var i=0; i<areas.length; i++) {
                                nozzleNodes.push({id:course_id.course_id + "-" + areas[i].id,name:areas[i].name,parent_id:course_id.course_id,icon:"/img/区域.png"});
                            }
                            eachAsync(area_ids, function(area_id, index, done) {
                                db.exec("select distinct(hole) from nozzle where course_id=? and area_id=? order by hole", [course_id.course_id, area_id.area_id], function (holes) {
                                    for(var i=0; i<holes.length; i++) {
                                        nozzleNodes.push({id:course_id.course_id + "-" + area_id.area_id + "-" + holes[i].hole,name:holes[i].hole + "洞",parent_id:course_id.course_id + "-" + area_id.area_id,icon:"/img/球洞.png"});
                                    }
                                    done();
                                });
                            }, function() {
                                done();
                            });
                        });
                    });
                }, function() {
                    db.exec("select a.*,b.no as controlbox_no from nozzle a join controlbox b on a.controlbox_id=b.id order by b.no, a.no", [], function (nozzles) {
                        for(var i=0; i<nozzles.length; i++) {
                            var str = "";
                            if (nozzles[i].use_state === 0) {
                                str = "[正在维修]";
                            }
                            nozzleNodes.push({id:"t" + nozzles[i].id,name:nozzles[i].controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name + str,parent_id:nozzles[i].course_id + "-" + nozzles[i].area_id + "-" + nozzles[i].hole,icon:"/img/喷头.png"});
                        }
                        res.render('task_step', {
                            nozzleNodes: nozzleNodes,
                            steps: steps,
                            step_count: steps.length,
                            last_index: last_index
                        });
                    });
                });
            });
        });
    });
});
// 打开管网设置页面
app.get("/pipe.html", function (req, res) {
    db.exec("select * from pipe order by id", [], function (pipes) {
        if (pipes.length === 0) {
            pipes.push({id:1,name:"球场管网",parent_id:0,flow:0});
        }
        var max_pipe_id = pipes[pipes.length - 1].id;
        var pipeNodes = [];
        for(var i=0; i<pipes.length; i++) {
            if (pipes[i].name === "球场管网") {
                pipeNodes.push({id:pipes[i].id,name:pipes[i].name,parent_id:pipes[i].parent_id,icon:"/img/泵站.png"});
            } else {
                pipeNodes.push({id:pipes[i].id,name:pipes[i].name + " " + pipes[i].flow,parent_id:pipes[i].parent_id,icon:"/img/管道.png"});
            }
        }
        db.exec("select distinct(course_id) from nozzle", [], function (course_ids) {
            var where = "";
            for(var i=0; i< course_ids.length; i++) {
                where += "id=" + course_ids[i].course_id + " or ";
            }
            where += "1=0";
            db.exec("select * from course where (" + where + ") order by id", [], function (courses) {
                var nozzleNodes = [];
                for(var i=0; i<courses.length; i++) {
                    nozzleNodes.push({id:courses[i].id,name:courses[i].name,parent_id:-1,icon:"/img/球场.png"});
                }
                eachAsync(course_ids, function(course_id, index, done) {
                    db.exec("select distinct(area_id) from nozzle where course_id=?", [course_id.course_id], function (area_ids) {
                        var where = "";
                        for(var i=0; i< area_ids.length; i++) {
                            where += "id=" + area_ids[i].area_id + " or ";
                        }
                        where += "1=0";
                        db.exec("select * from area where (" + where + ") order by id", [], function (areas) {
                            for(var i=0; i<areas.length; i++) {
                                nozzleNodes.push({id:course_id.course_id + "-" + areas[i].id,name:areas[i].name,parent_id:course_id.course_id,icon:"/img/区域.png"});
                            }
                            eachAsync(area_ids, function(area_id, index, done) {
                                db.exec("select distinct(hole) from nozzle where course_id=? and area_id=? order by hole", [course_id.course_id, area_id.area_id], function (holes) {
                                    for(var i=0; i<holes.length; i++) {
                                        nozzleNodes.push({id:course_id.course_id + "-" + area_id.area_id + "-" + holes[i].hole,name:holes[i].hole + "洞",parent_id:course_id.course_id + "-" + area_id.area_id,icon:"/img/球洞.png"});
                                    }
                                    done();
                                });
                            }, function() {
                                done();
                            });
                        });
                    });
                }, function() {
                    db.exec("select a.*,b.no as controlbox_no from nozzle a left join controlbox b on a.controlbox_id=b.id order by b.no, a.no", [], function (nozzles) {
                        for(var i=0; i<nozzles.length;i++) {
                            var controlbox_no = "无分控箱";
                            if (nozzles[i].controlbox_no !== null) {
                                controlbox_no = nozzles[i].controlbox_no;
                            }
                            if (nozzles[i].pipe_id !== null) {
                                pipeNodes.push({id:"t" + nozzles[i].id,name:controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name,parent_id:nozzles[i].pipe_id,icon:"/img/喷头.png"});
                            } else {
                                nozzleNodes.push({id:"t" + nozzles[i].id,name:controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name,parent_id:nozzles[i].course_id + "-" + nozzles[i].area_id + "-" + nozzles[i].hole,icon:"/img/喷头.png"});
                            }
                        }
                        res.render('pipe', {
                            max_pipe_id: max_pipe_id,
                            pipeNodes: pipeNodes,
                            nozzleNodes: nozzleNodes,
                            user: req.session.user,
                            can_irrigate: req.session.user['can_irrigate']
                        });
                    });
                });
            });
        });
    });
});
// 打开球场地图页面
app.get("/map.html", function (req, res) {
    db.exec("select * from controlbox order by no", [], function (controlboxes) {
        var nozzleNodes = [];
        nozzleNodes.push({id:"c9999",name:"无分控箱",parent_id:0,icon:"/img/分控箱.png",x:-1,y:-1,color:"",shot_count:0});  // 把无分控箱也作为一个节点加进去
        for(var i=0; i<controlboxes.length;i++) {
            nozzleNodes.push({id:"c" + controlboxes[i].no,name:controlboxes[i].no + "：" + controlboxes[i].name,parent_id:0,icon:"/img/分控箱.png",x:(controlboxes[i].x === null)?-1:controlboxes[i].x,y:(controlboxes[i].y === null)?-1:controlboxes[i].y,color:(controlboxes[i].color === null)?"":controlboxes[i].color,shot_count:0});
        }
        db.exec("select a.*,b.no as controlbox_no from nozzle a left join controlbox b on a.controlbox_id=b.id order by b.no, a.no", [], function (nozzles) {
            for(var i=0; i<nozzles.length;i++) {
                if (nozzles[i].controlbox_no === null) {  // 洒水站没有分控箱
                    nozzleNodes.push({id:"nc9999-" + nozzles[i].id,name:"无分控箱-" + ((nozzles[i].no === null)?"无编号":nozzles[i].no) + ((nozzles[i].name === null)?"":"：" + nozzles[i].name),parent_id:"c9999",icon:"/img/喷头.png",x:(nozzles[i].x === null)?-1:nozzles[i].x,y:(nozzles[i].y === null)?-1:nozzles[i].y,color:(nozzles[i].color === null)?"":nozzles[i].color,shot_count:(nozzles[i].shot_count === null)?1:nozzles[i].shot_count});
                } else {
                    nozzleNodes.push({id:"nc" + nozzles[i].controlbox_no + "-" + nozzles[i].no,name:nozzles[i].controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name,parent_id:"c" + nozzles[i].controlbox_no,icon:"/img/喷头.png",x:(nozzles[i].x === null)?-1:nozzles[i].x,y:(nozzles[i].y === null)?-1:nozzles[i].y,color:(nozzles[i].color === null)?"":nozzles[i].color,shot_count:(nozzles[i].shot_count === null)?1:nozzles[i].shot_count});
                }
            }
            res.render('map', {
                nozzleNodes: nozzleNodes,
                width: map_width,
                height: map_height,
                user: req.session.user,
                can_irrigate: req.session.user['can_irrigate']
            });
        });
    });
});
// 打开设备型号页面
app.get("/controlbox_model.html", function (req, res) {
    db.exec("select * from controlbox_model order by id", [], function (models) {
        res.render('controlbox_model', {
            models: models,
            user: req.session.user,
            can_irrigate: req.session.user['can_irrigate']
        });
    });
});
// 打开喷嘴型号页面
app.get("/nozzle_model.html", function (req, res) {
    db.exec("select * from nozzle_model order by id", [], function (models) {
        res.render('nozzle_model', {
            models: models,
            user: req.session.user,
            can_irrigate: req.session.user['can_irrigate']
        });
    });
});
// 打开喷头形状页面
app.get("/nozzle_shape.html", function (req, res) {
    db.exec("select * from nozzle_shape order by id", [], function (shapes) {
        res.render('nozzle_shape', {
            shapes: shapes,
            user: req.session.user,
            can_irrigate: req.session.user['can_irrigate']
        });
    });
});
// 打开场地代码页面
app.get("/turf.html", function (req, res) {
    db.exec("select * from turf order by id", [], function (turfs) {
        res.render('turf', {
            turfs: turfs,
            user: req.session.user,
            can_irrigate: req.session.user['can_irrigate']
        });
    });
});
const EARTH_RADIUS = 6378137;  //地球半径，米
function rad(d) {
    return d * Math.PI / 180.0;
}
// 计算两点距离
function distance(lng1, lat1, lng2, lat2) {
    var radLat1 = rad(lat1);
    var radLat2 = rad(lat2);
    var a = radLat1 - radLat2;
    var b = rad(lng1) - rad(lng2);
    var s = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(a/2),2) + Math.cos(radLat1)*Math.cos(radLat2)*Math.pow(Math.sin(b/2),2)));
    s = s * EARTH_RADIUS;
    s = Math.round(s * 10000) / 10000;
    return Math.abs(s);
}
// 打开移动端页面，百度地图
app.get("/gps_control.html", function (req, res) {
    db.exec("select * from controlbox order by no", [], function (controlboxes) {
        var adj_controlboxes = [];
        var near_controlboxes = [];
        var far_controlboxes = [];
        var nozzleNodes = [];
        if (req.query.lon) {
            var lon = parseFloat(req.query.lon);
            var lat = parseFloat(req.query.lat);
            var where = "";
            var controlbox_lon = 0, controlbox_lat = 0;
            var once = true;
            for(var i=0; i<controlboxes.length; i++) {
                if (controlboxes[i].lon !== null) {
                    var d = distance(lon, lat, controlboxes[i].lon, controlboxes[i].lat);
                    if (d <= process.env.ADJACENT_DISTANCE) {
                        adj_controlboxes.push(controlboxes[i]);
                    } else if (d <= process.env.NEAR_DISTANCE) {
                        near_controlboxes.push(controlboxes[i]);
                    } else {
                        far_controlboxes.push(controlboxes[i]);
                    }
                    if (controlboxes[i].use_state === 1) {
                        controlboxes[i].fullname = controlboxes[i].no + "：" + controlboxes[i].name;
                    } else {
                        controlboxes[i].fullname = controlboxes[i].no + "：" + controlboxes[i].name + "[断网]";
                    }
                    nozzleNodes.push({id:controlboxes[i].id,name:controlboxes[i].fullname,parent_id:0,icon:"/img/分控箱.png",isHidden:true});
                    where += "b.id=" + controlboxes[i].id + " or ";
                    if (once) {
                        controlbox_lon = controlboxes[i].lon;
                        controlbox_lat = controlboxes[i].lat;
                        once = false;
                    }
                    if (req.query.id === "" + controlboxes[i].id) {
                        controlbox_lon = controlboxes[i].lon;
                        controlbox_lat = controlboxes[i].lat;
                    }
                }
            }
            where += "1=0";
            db.exec("select a.*,b.no as controlbox_no from nozzle a join controlbox b on a.controlbox_id=b.id where (" + where + ") order by b.no, a.no", [], function (nozzles) {
                for(var i=0; i<nozzles.length; i++) {
                    var str = "";
                    if (nozzles[i].use_state === 0) {
                        str = "[正在维修]";
                    } else {
                        if (nozzles[i].state === 1) {
                            str = "[正在洒水]";
                        }
                    }
                    var str2 = '';
                    if (nozzles[i].remain_time !== null) {
                        str2 = "(提前" + Math.round(nozzles[i].remain_time / 60) + "分钟暂停)";
                    }
                    nozzleNodes.push({id:"t" + nozzles[i].id,name:nozzles[i].controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name + str + str2,parent_id:nozzles[i].controlbox_id,icon:"/img/喷头.png"});
                }
                res.render('gps_control', {
                    controlboxes: controlboxes,
                    adj_controlboxes: adj_controlboxes,
                    near_controlboxes: near_controlboxes,
                    far_controlboxes: far_controlboxes,
                    nozzleNodes: nozzleNodes,
                    lon: lon,
                    lat: lat,
                    controlbox_lon: controlbox_lon,
                    controlbox_lat: controlbox_lat,
                    can_pos: req.session.user['can_pos'],
                    can_irrigate: req.session.user['can_irrigate']
                });
            });
        } else {
            res.render('gps_control', {
                controlboxes: controlboxes,
                adj_controlboxes: adj_controlboxes,
                near_controlboxes: near_controlboxes,
                far_controlboxes: far_controlboxes,
                nozzleNodes: nozzleNodes,
                lon: "",
                lat: ""
            });
        }
    });
});
/** ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- **/
// catch 404 and forward to error handler
app.use(function (req, res) {
    res.redirect('/404.html');
});

var server = http.createServer(app);
server.listen(process.env.SCHEDULED_SERVICE_PORT, '0.0.0.0');

process.on('SIGINT', function() {
    log4js.shutdown(function() {
        mqtt_client.end();
        console.log('%s " + process.env.CLUB_NAME + "中控停止运行', moment().format("YYYY-MM-DD HH:mm:ss"));
        process.exit();
    });
});
