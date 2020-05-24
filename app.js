require('dotenv').config({ path: './app.env' });
process.env.TZ = "Asia/Shanghai";
const http = require('http');
// const https = require('https');
// const fs = require('fs');
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
const mqtt = require('mqtt');
const mqtt_client  = mqtt.connect(process.env.MQTT_URL, {username: process.env.MQTT_USER, password: process.env.MQTT_PASSWORD, clientId: process.env.MQTT_USER, clean: false});
mqtt_client.on('connect', function () {
    mqtt_client.subscribe(process.env.MQTT_BOTTOMUP_TOPIC, {qos: 1});
});
const schedule = require('node-schedule');
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
/** ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- **/
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
        },
        // 远程服务器统一存储
        remote: {type: 'tcp', host: process.env.LOG_SERVER_HOST, port: process.env.LOG_SERVER_PORT}
    },
    categories: {
        access: {appenders: ['access'], level: 'info'},
        default: {appenders: ['local', 'remote'], level: 'debug'}  // 如果不是分布式，只file一个。如果多结点集群，则file，server两个。
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
                    db.exec("select a.id as id,a.no as no,a.use_state as use_state,a.state from nozzle a join controlbox b on a.controlbox_id=b.id and b.no=?", [controlbox_no], function (nozzles) {
                        for(var i=0; i<nozzles.length; i++) {
                            if (up_states[nozzles[i].no] !== nozzles[i].state) {
                                if (up_states[nozzles[i].no] === 0) {
                                    db.exec("update nozzle set state=0 where id=?", [nozzles[i].id]);
                                    db.exec("update job set end_time=? where nozzle_id=? and start_time<? and end_time is null", [current_time, nozzles[i].id, current_time]);
                                } else {
                                    db.exec("update nozzle set state=1,use_state=1 where id=?", [nozzles[i].id]);
                                }
                            }
                        }
                        console.log("[" + current_time + "] 分控箱报告状态的指令：" + msg);
                    });
                });
            } else {
                console.log("[" + current_time + "] 忽略本地控制指令：" + msg);
            }
        } else if (commands[0] === process.env.COMMAND_REMOTE_OR_LOCAL_CONTROL_FEEDBACK) {
            console.log("[" + current_time + "] 远程或本地控制命令的反馈命令nothing to do：" + msg);  ///////////////////
        }
    } else {
        console.log("[" + current_time + "] CRC16校验错误：" + msg);
    }
});
function check_crc(message) {
    var str = message.substr(0, message.length - 4);
    var crc = message.substring(message.length - 4);
    return left_pad(crc16(str).toString(16), 4) === crc.toUpperCase();
}
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
                title: "plan" + req.params.plan_id + "-step" + step_no
            }).then(function(data) { // 有这个job，则删除
                scheduler.deleteEvent({
                    id: data.event.id
                }).then(function() {
                    scheduler.createEvent({
                        title: "plan" + req.params.plan_id + "-step" + step_no,
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
                    title: "plan" + req.params.plan_id + "-step" + step_no,
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
    db.exec("select a.id as nozzle_id, b.no as controlbox_no, a.no as nozzle_no, c.moisture from nozzle a join controlbox b on a.controlbox_id=b.id left join turf c on a.turf_id=c.id where a.use_state=1 and (" + where + ")", [], function (results) {
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
                mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: 1}, function (err) {
                    if (!err) {
                        db.exec("insert into job(plan_id,nozzle_id,nozzle_address,start_time,how_long) values " + value, []);
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
        mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: 1}, function (err) {
            if (!err) {
                db.exec("insert into job(plan_id,nozzle_id,nozzle_address,start_time,how_long) values " + value, [], function(results) {
                    res.end("1");
                });
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
/** ----------------------------------------------------------------------------------------- 从 AJAX 请 求，代 表 操 作 ----------------------------------------------------------------------------------------------- **/
// 登录操作
app.post("/login.do", function (req, res) {
    db.exec("select id,name,password,real_name from user where name=? and password=?", [req.body.username, req.body.password], function (users) {
        if (users.length === 1) {  // 登陆成功
            var fromIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || req.ip || req.connection.socket.remoteAddress;
            db.exec("update user set login_time=?, from_ip=? where name=? and password=?", [moment().format("YYYY-MM-DD HH:mm:ss"), fromIp, req.body.username, req.body.password], function () {
                req.session.click_count = 0;
                req.session.user = users[0];
                real_name = req.session.user['real_name'];
                if (logger.isInfoEnabled()) {
                    logger.addContext('real_name', real_name);
                    logger.info("%s于%s登录系统", req.body.username, moment().format("YYYY-MM-DD HH:mm:ss"));
                }
                res.redirect("/dynamics.html");
            });
        } else {
            res.render("login", {fail: [0]});  // 登录失败
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
// 增加点击数操作
app.post("/inc_click_count.do", function (req, res) {
    req.session.click_count = req.session.click_count + 1;
    res.end();
});
// 全部停止的操作
app.post("/stop_all.do", function (req, res) {
    var command = process.env.COMMAND_STOP + "|";
    command = command + left_pad(crc16(command).toString(16), 4);
    mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: 1}, function (err) {
        if (!err) {
            res.json({success: true});
        } else {
            res.json({failure: true});
        }
    });
});
// 手动灌溉，实时发送指令的操作
app.post("/send.do", function (req, res) {
    var howlong = parseInt(req.body.hour) * 3600 + parseInt(req.body.minute) * 60;  //秒
    var nozzle_ids = JSON.parse(req.body.nozzle_ids);
    var where = "";
    for(var i=0; i< nozzle_ids.length; i++) {
        where += "a.id=" + nozzle_ids[i] + " or ";
    }
    where += "1=0";
    db.exec("select a.id as nozzle_id, b.no as controlbox_no, a.no as nozzle_no, c.moisture from nozzle a join controlbox b on a.controlbox_id=b.id left join turf c on a.turf_id=c.id where (" + where + ")", [], function (results) {
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
                mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: 1}, function (err) {
                    if (!err) {
                        db.exec("insert into job(nozzle_id,nozzle_address,start_time,how_long) values " + value, []);
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
        mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: 1}, function (err) {
            if (!err) {
                db.exec("insert into job(nozzle_id,nozzle_address,start_time,how_long) values " + value, [], function() {
                    res.json({success: true});
                });
            } else {
                res.json({failure: true});
            }
        });
    });
});
// 取消所有洒水计划的操作（删除Cronicle中除了dump_job以外的所有事件）
app.post("/cancel_all.do", function (req, res) {
    scheduler.getSchedule({
        limit: 1000
    }).then(function (data) {  // 取出所有job
        eachAsync(data.rows, function(plan_or_step, index, done) {
            if (plan_or_step.title !== 'dump_job') {
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
                if (logger.isInfoEnabled()) {
                    logger.addContext('real_name', real_name);
                    logger.info("%s于%s取消所有洒水计划", req.session.user.name, moment().format("YYYY-MM-DD HH:mm:ss"));
                }
                res.json({success: true});
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

    eachAsync(plan_ids, function(plan_id, i, done) {
        if (plan_id.indexOf('-') < 0) {  // 已有该计划
            db.exec("select task_id,start_time from plan where id=?", [plan_id], function (plans) {
                if (moment(plans[0].start_time).format("YYYY-MM-DD HH:mm:ss") !== start_times[i]) {  // 如果开始时间变了，修改开始时间
                    db.exec("update plan set start_time=? where id=?", [start_times[i], plan_id], function (results) {
                        scheduler.getEvent({
                            title: "plan" + plan_id
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
                        title: "plan" + plans[0].id,
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
                title: "plan" + delExistingPlanId
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
            db.exec("insert into controlbox(no,name,model_id,nozzle_count,lon,lat,color,last_recv_time) values(?,?,?,?,?,?,?,?)", [req.body.no, req.body.name, req.body.model_id, req.body.nozzle_count, req.body.lon, req.body.lat, color, moment().format("YYYY-MM-DD HH:mm:ss")], function () {
                res.json({success: true});
            });
        }
    });
});
// 修改分控箱操作
app.post("/update_controlbox.do", function (req, res) {
    var update_no = JSON.parse(req.body.update_no);
    if (!update_no) {
        db.exec("update controlbox set name=?,model_id=?,nozzle_count=? where id=?", [req.body.name, req.body.model_id, req.body.nozzle_count, req.body.id], function () {
            res.json({success: true});
        });
    } else {
        db.exec("select id from controlbox where no=?", [req.body.no], function (ids) {
            if (ids.length > 0) {
                res.json({failure: true});  // 分控箱编号重复
            } else {
                db.exec("update controlbox set no=?,name=?,model_id=?,nozzle_count=?,lon=?,lat=? where id=?", [req.body.no, req.body.name, req.body.model_id, req.body.nozzle_count, req.body.lon, req.body.lat, req.body.id], function () {
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
            mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: 1}, function (err) {
                if (!err) {
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
            mqtt_client.publish(process.env.MQTT_TOPDOWN_TOPIC, command, {qos: 1}, function (err) {
                if (!err) {
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
                res.json({success: true});
            });
        }
    });
});
// 修改洒水站操作
app.post("/update_nozzle.do", function (req, res) {
    var update_no = JSON.parse(req.body.update_no);
    if (!update_no) {
        db.exec("update nozzle set name=?,course_id=?,hole=?,area_id=?,model_id=?,shape_id=?,angle=?,shot_count=?,waterfall_rate=?,turf_id=? where id=?", [req.body.name, req.body.course_id, req.body.hole, req.body.area_id, req.body.model_id, req.body.shape_id, JSON.parse(req.body.angle), JSON.parse(req.body.shot_count), JSON.parse(req.body.waterfall_rate), req.body.turf_id, req.body.id], function () {
            res.json({success: true});
        });
    } else {
        db.exec("select id from nozzle where controlbox_id=? and no=?", [req.body.controlbox_id, req.body.no], function (ids) {
            if (ids.length > 0) {
                res.json({failure: true});  // 洒水站编号重复
            } else {
                db.exec("update nozzle set controlbox_id=?,no=?,name=?,course_id=?,hole=?,area_id=?,model_id=?,shape_id=?,angle=?,shot_count=?,waterfall_rate=?,turf_id=? where id=?", [req.body.controlbox_id, req.body.no, req.body.name, req.body.course_id, req.body.hole, req.body.area_id, req.body.model_id, req.body.shape_id, JSON.parse(req.body.angle), JSON.parse(req.body.shot_count), JSON.parse(req.body.waterfall_rate), req.body.turf_id, req.body.id], function () {
                    res.json({success: true});
                });
            }
        });
    }
});
// 分配洒水站操作
app.post("/distribute_nozzle.do", function (req, res) {
    db.exec("select id from nozzle where controlbox_id=? and no=?", [req.body.controlbox_id, req.body.no], function (ids) {
        if (ids.length > 0) {
            res.json({failure: true});  // 洒水站编号重复
        } else {
            db.exec("update nozzle set controlbox_id=?,no=?,name=?,course_id=?,hole=?,area_id=?,model_id=?,shape_id=?,angle=?,shot_count=?,waterfall_rate=?,turf_id=? where id=?", [req.body.controlbox_id, req.body.no, req.body.name, req.body.course_id, req.body.hole, req.body.area_id, req.body.model_id, req.body.shape_id, JSON.parse(req.body.angle), JSON.parse(req.body.shot_count), JSON.parse(req.body.waterfall_rate), req.body.turf_id, req.body.id], function () {
                db.exec("update nozzle a join controlbox b on a.controlbox_id=b.id set a.color=b.color where a.id=?", [req.body.id], function () {
                    res.json({success: true});
                });
            });
        }
    });
});
// 删除洒水站操作
app.post("/del_nozzle.do", function (req, res) {
    db.exec("delete from nozzle where id=?", [req.body.id], function () {
        res.json({success: true});
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
                    steps.forEach(function (step, i, array) {
                        db.exec("insert into step(task_id,how_long,involved_nozzle) values(?,?,?)", [tasks[0].id, step.s, step.n]);
                    });
                    res.json({success: true});
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
            steps.forEach(function (step, i, array) {
                db.exec("insert into step(task_id,how_long,involved_nozzle) values(?,?,?)", [req.body.id, step.s, step.n]);
            });
            res.json({success: true});
        });
    });
});
// 删除洒水任务
app.post("/del_task.do", function (req, res) {
    db.exec("select distinct(id) from plan where task_id=?", [req.body.id], function (plans) {
        eachAsync(plans, function(plan, index, done) {
            scheduler.getEvent({
                title: "plan" + plan.id
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
                eachAsync(nozzles, function(nozzle, index, done) {
                    var no = nozzle.no.split("-");
                    if (no[0] === '9999') {  // 洒水站没有分控箱
                        db.exec("update nozzle set x=?, y=?, color=? where id=?", [nozzle.x, nozzle.y, nozzle.color, no[1]], function () {
                            done();
                        });
                    } else {
                        db.exec("update nozzle a join controlbox b on a.controlbox_id=b.id set a.x=?, a.y=?, a.color=? where b.no=? and a.no=?", [nozzle.x, nozzle.y, nozzle.color, no[0], no[1]], function () {
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
/** ------------------------------------------------------------------------------------------ 从 网 页 请 求 ---------------------------------------------------------------------------------------------- **/
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
            click_count: req.session.click_count % 2
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
                            user: req.session.user,
                            click_count: req.session.click_count % 2
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
            user: req.session.user,
            click_count: req.session.click_count % 2
        });
    });
});
const EARTH_RADIUS = 6378137;  //地球半径，米
// 计算两点距离
function distance(lng1, lat1, lng2, lat2) {
    var radLat1 = lat1 * Math.PI / 180.0;
    var radLat2 = lat2 * Math.PI / 180.0;
    var a = radLat1 - radLat2;
    var b = lng1 * Math.PI / 180.0 - lng2 * Math.PI / 180.0;
    var s = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(a/2),2) + Math.cos(radLat1)*Math.cos(radLat2)*Math.pow(Math.sin(b/2),2)));
    s = s * EARTH_RADIUS;
    s = Math.round(s * 10000) / 10000;
    return Math.abs(s);
}
// 打开手动灌溉按位置选洒水站页面
app.get("/manual_location.html", function (req, res) {
    db.exec("select * from controlbox where use_state=1 order by id", [], function (controlboxes) {
        var boxes = [];
        for(var i=0; i<controlboxes.length; i++) {
            if (distance(req.query.lon, req.query.lat, controlboxes[i].lon, controlboxes[i].lat) <= process.env.LOCATION_CONTROL_DISTANCE) {
                boxes.push(controlboxes[i]);
            }
        }
        var nozzleNodes = [];
        for(var i=0; i<boxes.length; i++) {
            nozzleNodes.push({id:boxes[i].id,name:boxes[i].no + "：" + boxes[i].name,parent_id:0,icon:"/img/分控箱.png"});
        }
        db.exec("select a.*,b.no as controlbox_no from nozzle a join controlbox b on a.controlbox_id=b.id order by b.no, a.no", [], function (nozzles) {
            for(var i=0; i<nozzles.length; i++) {
                var str = "";
                if (nozzles[i].use_state === 0) {
                    str = "[正在维修]";
                } else {
                    if (nozzles[i].state === 1) {
                        str = "[正在洒水]";
                    }
                }
                nozzleNodes.push({id:"t" + nozzles[i].id,name:nozzles[i].controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name + str,parent_id:nozzles[i].controlbox_id,icon:"/img/喷头.png"});
            }
            res.render('manual_location', {
                nozzleNodes: nozzleNodes
            });
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
                    nozzleNodes.push({id:"t" + nozzles[i].id,name:nozzles[i].controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name + str,parent_id:nozzles[i].controlbox_id,icon:"/img/喷头.png"});
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
                        nozzleNodes.push({id:"t" + nozzles[i].id,name:nozzles[i].controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name + str,parent_id:nozzles[i].area_id + "-" + nozzles[i].hole,icon:"/img/喷头.png"});
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
            res.render('plan', {
                tasks: tasks,
                plans: plans,
                user: req.session.user,
                click_count: req.session.click_count % 2
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
            click_count: req.session.click_count % 2
        });
    });
});
// 打开区域设置子页面
app.get("/area.html", function (req, res) {
    db.exec("select * from area order by id", [], function (areas) {
        res.render('area', {
            areas: areas,
            user: req.session.user,
            click_count: req.session.click_count % 2
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
                click_count: req.session.click_count % 2
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
            click_count: req.session.click_count % 2
        });
    });
});
// 打开洒水步骤子页面
app.get("/task_step.html", function (req, res) {
    db.exec("select * from step where task_id=" + JSON.parse(req.query.task_id), [], function (steps) {
        var last_index = -1;
        for (var i = 0; i < steps.length; i++) {
            steps[i].hour = parseInt(steps[i].how_long / 3600);
            steps[i].minute = steps[i].how_long % 3600 / 60;
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
                            } else {
                                if (nozzles[i].state === 1) {
                                    str = "[正在洒水]";
                                }
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
                            click_count: req.session.click_count % 2
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
        nozzleNodes.push({id:"c9999",name:"无分控箱",parent_id:0,icon:"/img/分控箱.png",x:-1,y:-1,color:""});  // 把无分控箱也作为一个节点加进去
        for(var i=0; i<controlboxes.length;i++) {
            nozzleNodes.push({id:"c" + controlboxes[i].no,name:controlboxes[i].no + "：" + controlboxes[i].name,parent_id:0,icon:"/img/分控箱.png",x:(controlboxes[i].x === null)?-1:controlboxes[i].x,y:(controlboxes[i].y === null)?-1:controlboxes[i].y,color:(controlboxes[i].color === null)?"":controlboxes[i].color});
        }
        db.exec("select a.*,b.no as controlbox_no from nozzle a left join controlbox b on a.controlbox_id=b.id order by b.no, a.no", [], function (nozzles) {
            for(var i=0; i<nozzles.length;i++) {
                if (nozzles[i].controlbox_no === null) {  // 洒水站没有分控箱
                    nozzleNodes.push({id:"nc9999-" + nozzles[i].id,name:"无分控箱-" + nozzles[i].no + "：" + nozzles[i].name,parent_id:"c9999",icon:"/img/喷头.png",x:(nozzles[i].x === null)?-1:nozzles[i].x,y:(nozzles[i].y === null)?-1:nozzles[i].y,color:(nozzles[i].color === null)?"":nozzles[i].color});
                } else {
                    nozzleNodes.push({id:"nc" + nozzles[i].controlbox_no + "-" + nozzles[i].no,name:nozzles[i].controlbox_no + "-" + nozzles[i].no + "：" + nozzles[i].name,parent_id:"c" + nozzles[i].controlbox_no,icon:"/img/喷头.png",x:(nozzles[i].x === null)?-1:nozzles[i].x,y:(nozzles[i].y === null)?-1:nozzles[i].y,color:(nozzles[i].color === null)?"":nozzles[i].color});
                }
            }
            res.render('map', {
                nozzleNodes: nozzleNodes,
                user: req.session.user,
                click_count: req.session.click_count % 2
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
            click_count: req.session.click_count % 2
        });
    });
});
// 打开喷嘴型号页面
app.get("/nozzle_model.html", function (req, res) {
    db.exec("select * from nozzle_model order by id", [], function (models) {
        res.render('nozzle_model', {
            models: models,
            user: req.session.user,
            click_count: req.session.click_count % 2
        });
    });
});
// 打开喷头形状页面
app.get("/nozzle_shape.html", function (req, res) {
    db.exec("select * from nozzle_shape order by id", [], function (shapes) {
        res.render('nozzle_shape', {
            shapes: shapes,
            user: req.session.user,
            click_count: req.session.click_count % 2
        });
    });
});
// 打开场地代码页面
app.get("/turf.html", function (req, res) {
    db.exec("select * from turf order by id", [], function (turfs) {
        res.render('turf', {
            turfs: turfs,
            user: req.session.user,
            click_count: req.session.click_count % 2
        });
    });
});
/** ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- **/
// catch 404 and forward to error handler
app.use(function (req, res) {
    res.redirect('/404.html');
});

var server = http.createServer(app);
server.listen(process.env.SCHEDULED_SERVICE_PORT, '0.0.0.0');
/*var credentials = {
    key: fs.readFileSync(path.join(__dirname, 'ssl/privkey.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'ssl/cert.pem'))
};
var https_server = https.createServer(credentials, app);
https_server.listen(process.env.HTTPS_SERVICE_PORT, '0.0.0.0');*/
process.on('SIGINT', function() {
    log4js.shutdown(function() {
        mqtt_client.end();
        console.log('%s 应用退出', moment().format("YYYY-MM-DD HH:mm:ss"));
        process.exit();
    });
});