require('dotenv').config({ path: './app.env' });
const mysql = require('mysql');

var pool = mysql.createPool({
    connectionLimit: 50,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DATABASE,
    supportBigNumbers: true,
    multipleStatements: true
});

module.exports.exec = function (sql, args, callback) {
    pool.query(sql, args, function (err, results) {
        if (err) {
            throw err;
        } else if (callback) {
            callback(results);
        }
    });
};