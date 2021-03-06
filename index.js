'use strict';

const express = require('express');
const cors = require('cors');
const JSON = require('JSON');
const app = express();
const redis = require('redis');
const redis_config = require('./redis-config.json');
const port = 3000;
const async = require('async');
const { logger } = require('./logger');
const client = redis.createClient(redis_config.port, redis_config.host);
const multi = client.multi();

const resultok = '{"resultcode":"1a","resultdesc":"ok","resultdata":[]}';

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

client.auth(redis_config.auth);
client.on('error', (err) => {
    console.log('redis error ' + err);
});

app.get('/', function (req, res) {
    logger.info('test root url');
    return res.send('hello');
});

app.post('/facredis/adddata', function (req, res) {
    var reqquery = req.query.a;

    if (!reqquery) {
        var obj = JSON.parse(req.body.a);
        logger.info('adddata?a=' + req.body.a);
    } else {
        var obj = JSON.parse(req.query.a);
        logger.info('adddata?a=' + req.query.a);
    }

    let inkey = obj.key;
    let invalue = obj.value;
    let expiretime = obj.expiretime;

    if (!inkey || !invalue) {
        return res.send({
            resultcode: '9a',
            resultdesc: 'empty parameter',
            resultdata: '',
        });
    }

    if (expiretime == '0' || expiretime == '') {
        multi.set(inkey, invalue, 'NX');
    } else {
        multi.set(inkey, invalue, 'EX', expiretime, 'NX');
    }
    multi.exec(function (err, result) {
        if (err) {
            logger.info('redis adddata return value : FAIL(err : ' + err + ')');
            return res.send({
                resultcode: '91',
                resultdesc: 'err',
                resultdata: 'redis multi.set err',
            });
        }

        if (result == '') {
            logger.info('redis adddata return value : duplication key');
            client.keys(inkey, function (err, keys) {
                if (err) throw err;
                if (keys) {
                    async.map(
                        keys,
                        function (key, callback) {
                            var job = {};
                            client.get(key, function (err, value) {
                                // key?????? value ??????
                                if (err) throw err;
                                job['key'] = key;
                                job['value'] = value;
                            });
                            client.ttl(key, function (err, ttl) {
                                if (err) throw err;
                                job['expiretime'] = ttl;
                                callback(null, job);
                            });
                        },
                        function (err, results) {
                            if (err) throw err;
                            // ?????? ??? ??????, insert  ??????, ?????? key, value, ttl ??????
                            return res.send({
                                resultcode: '9y',
                                resultdesc: 'ok',
                                resultdata: results,
                            });
                        }
                    );
                }
            });
        } else {
            //?????? ??? ?????? & insert ??????
            logger.info('redis adddata return value : ' + result);
            return res.send(resultok);
        }
    });
});

app.get('/facredis/deletedata', function (req, res) {
    const obj = JSON.parse(req.query.a);
    const inkey = obj.key;
    logger.info(req.query.a);
    if (!inkey) {
        return res.send({
            resultcode: '9a',
            resultdesc: 'empty parameter',
            resultdata: '',
        });
    }

    client.del(inkey, function (err) {
        if (err) throw err;
        return res.send(resultok);
    });
});

app.get('/facredis/cleardata', function (req, res) {
    const key = res.query.a;
    client.flushall(function (err, val) {
        if (err) throw err;
        logger.error(err);
        return res.send(resultok);
    });
});

app.get('/facredis/searchdata', async function (req, res) {
    const obj = JSON.parse(req.query.a);
    const inkey = obj.key;
    var inlikeyn = obj.likeyn;
    logger.info('searchdata?a=' + req.query.a);
    //return res.send('{"resultcode":"91","resultdesc":"empty parameter"}');
    //????????????
    if (inlikeyn == 'N' || inlikeyn == 'n') {
        client.get(inkey, function (err, val) {
            if (err) throw err;
            //console.log('result: ' + servername + '=' + val)
            if (!val) {
                console.log(val);
                return res.send({
                    resultcode: '9a',
                    resultdesc: 'not found data',
                    resultdata: '',
                });
            } else {
                return res.send({
                    resultcode: '1a',
                    resultdesc: 'ok',
                    resultdata: val,
                });
            }
        });
        // LIKE ?????? (?????? ????????? ?????????)
    } else if (inlikeyn == 'y' || inlikeyn == 'Y') {
        client.keys(inkey, function (err, keys) {
            // LIKE ???????????? ?????? ??? ?????? (inkey = ????????? ??? ???????????? ???, keys = inkey* ??? ????????? LIKE ?????? ??????)
            if (err) throw err;
            if (keys) {
                async.map(
                    //async.map(????????? ????????????, function(??????), function(??????))
                    //like???????????? ????????? ?????? ?????????(keys)??? map??????(?????????), ?????? ????????? ????????????
                    //key : value 1:1???????????? ????????? ??????(results)??? ??????
                    //async(????????? ??????->????????? ??????), .map ????????? ???????????? ????????? ????????? key?????? value 1:1 ??????
                    keys,
                    function (key, callback) {
                        //value??? ???????????? ?????? ????????????, ????????? key??? ??????????????? ??????
                        var job = {}; // ????????? ?????? ??????
                        client.get(key, function (err, value) {
                            // key?????? value ??????
                            if (err) throw err;
                            job['key'] = key;
                            job['value'] = value;
                        });
                        client.ttl(key, function (err, ttl) {
                            // key?????? ttl (expiretime) ??????
                            if (err) throw err;
                            job['expiretime'] = ttl;
                            callback(null, job);
                        });
                    },
                    function (err, results) {
                        //map??? callback ?????? ????????? ????????? JSON ????????? ??????
                        if (err) throw err;
                        if (results.length == 0) {
                            return res.send({
                                resultcode: '9a',
                                resultdesc: 'not found data',
                                resultdata: '',
                            });
                        } else {
                            return res.send({
                                resultcode: '1a',
                                resultdesc: 'ok',
                                resultdata: results,
                            });
                        }
                    }
                );
            }
        });
    } else {
        return res.send('invaild paramter');
    }
});

function getRedisData(inkey, callback) {
    client.keys(inkey, function (err, keys) {
        if (err) throw err;
        if (keys) {
            async.map(
                keys,
                function (key, callback) {
                    var job = {}; // ????????? ?????? ??????
                    client.get(key, function (err, value) {
                        if (err) throw err;
                        job['key'] = key;
                        job['value'] = value;
                    });
                    client.ttl(key, function (err, ttl) {
                        if (err) throw err;
                        job['expiretime'] = ttl;
                        callback(null, job);
                    });
                },
                function (err, results) {
                    if (err) throw err;

                    callback(results);
                }
            );
        }
    });
}

app.listen(port, function () {
    console.log('server on ' + 'port' + port);
});
