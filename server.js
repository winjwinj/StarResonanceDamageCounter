const cap = require('cap');
const cors = require('cors');
const readline = require('readline');
const winston = require('winston');
const zlib = require('zlib');
const express = require('express');
const http = require('http');
const net = require('net');
const path = require('path');
const { Server } = require('socket.io');
const fsPromises = require('fs').promises;
const PacketProcessor = require('./algo/packet');
const Readable = require('stream').Readable;
const Cap = cap.Cap;
const decoders = cap.decoders;
const PROTOCOL = decoders.PROTOCOL;
const print = console.log;
const app = express();
const { exec } = require('child_process');
const findDefaultNetworkDevice = require('./algo/netInterfaceUtil');

const skillConfig = require('./tables/final_merged.json');
const {BinaryReader} = require("./algo/packet");
const VERSION = '3.1';
const SETTINGS_PATH = path.join('./settings.json');
let globalSettings = {
    autoClearOnServerChange: true,
    autoClearOnTimeout: false,
    onlyRecordEliteDummy: false,
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
const devices = cap.deviceList();

// 暂停统计状态
let isPaused = false;

function ask(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

function getSubProfessionBySkillId(skillId) {
    switch (skillId) {
        case 220112:
        case 2203622:
            return 'Falconry';
        case 2292:
        case 1700820:
        case 1700825:
        case 1700827:
            return 'Wildpack';
        case 1714:
        case 1734:
            return 'Iaido';
        case 44701:
        case 179906:
            return 'Moonstrike';
        case 120901:
        case 120902:
            return 'Icicle';
        case 1241:
            return 'Frostbeam';
        case 1405:
        case 1418:
            return 'Vanguard';
        case 1419:
            return 'Skyward';
        case 1518:
        case 1541:
        case 21402:
            return 'Smite';
        case 20301:
            return 'Lifebind';
        case 199902:
            return 'Earthfort';
        case 1930:
        case 1931:
        case 1934:
        case 1935:
            return 'Block';
        case 2406:
            return 'Recovery';
        case 2405:
            return 'Shield';
        case 2306:
            return 'Dissonance';
        case 2307:
        case 2361:
        case 55302:
            return 'Concerto';
        default:
            return '';
    }
}

class Lock {
    constructor() {
        this.queue = [];
        this.locked = false;
    }

    async acquire() {
        if (this.locked) {
            return new Promise((resolve) => this.queue.push(resolve));
        }
        this.locked = true;
    }

    release() {
        if (this.queue.length > 0) {
            const nextResolve = this.queue.shift();
            nextResolve();
        } else {
            this.locked = false;
        }
    }
}

// 通用统计类，用于处理伤害或治疗数据
class StatisticData {
    constructor(user, type, element) {
        this.user = user;
        this.type = type || '';
        this.element = element || '';
        this.stats = {
            normal: 0,
            critical: 0,
            lucky: 0,
            crit_lucky: 0,
            hpLessen: 0, // 仅用于伤害统计
            total: 0,
        };
        this.count = {
            normal: 0,
            critical: 0,
            lucky: 0,
            total: 0,
        };
        this.realtimeWindow = []; // 实时统计窗口
        this.timeRange = []; // 时间范围 [开始时间, 最后时间]
        this.realtimeStats = {
            value: 0,
            max: 0,
        };
    }

    /** 添加数据记录
     * @param {number} value - 数值
     * @param {boolean} isCrit - 是否为暴击
     * @param {boolean} isLucky - 是否为幸运
     * @param {number} hpLessenValue - 生命值减少量（仅伤害使用）
     */
    addRecord(value, isCrit, isLucky, hpLessenValue = 0) {
        const now = Date.now();

        // 更新数值统计
        if (isCrit) {
            if (isLucky) {
                this.stats.crit_lucky += value;
            } else {
                this.stats.critical += value;
            }
        } else if (isLucky) {
            this.stats.lucky += value;
        } else {
            this.stats.normal += value;
        }
        this.stats.total += value;
        this.stats.hpLessen += hpLessenValue;

        // 更新次数统计
        if (isCrit) {
            this.count.critical++;
        }
        if (isLucky) {
            this.count.lucky++;
        }
        if (!isCrit && !isLucky) {
            this.count.normal++;
        }
        this.count.total++;

        this.realtimeWindow.push({
            time: now,
            value,
        });

        if (this.timeRange[0]) {
            this.timeRange[1] = now;
        } else {
            this.timeRange[0] = now;
        }
    }

    /** 更新实时统计 */
    updateRealtimeStats() {
        const now = Date.now();

        // 清除超过1秒的数据
        while (this.realtimeWindow.length > 0 && now - this.realtimeWindow[0].time > 1000) {
            this.realtimeWindow.shift();
        }

        // 计算当前实时值
        this.realtimeStats.value = 0;
        for (const entry of this.realtimeWindow) {
            this.realtimeStats.value += entry.value;
        }

        // 更新最大值
        if (this.realtimeStats.value > this.realtimeStats.max) {
            this.realtimeStats.max = this.realtimeStats.value;
        }
    }

    /** 计算总的每秒统计值 */
    getTotalPerSecond() {
        if (!this.timeRange[0] || !this.timeRange[1]) {
            return 0;
        }
        const totalPerSecond = (this.stats.total / (this.timeRange[1] - this.timeRange[0])) * 1000 || 0;
        if (!Number.isFinite(totalPerSecond)) return 0;
        return totalPerSecond;
    }

    /** 重置数据 */
    reset() {
        this.stats = {
            normal: 0,
            critical: 0,
            lucky: 0,
            crit_lucky: 0,
            hpLessen: 0,
            total: 0,
        };
        this.count = {
            normal: 0,
            critical: 0,
            lucky: 0,
            total: 0,
        };
        this.realtimeWindow = [];
        this.timeRange = [];
        this.realtimeStats = {
            value: 0,
            max: 0,
        };
    }
}

class UserData {
    constructor(uid) {
        this.uid = uid;
        this.name = '';
        this.damageStats = new StatisticData(this, 'DMG');
        this.healingStats = new StatisticData(this, 'Heal');
        this.takenDamage = 0; // 承伤
        this.deadCount = 0; // 死亡次数
        this.profession = '❓';
        this.skillUsage = new Map(); // 技能使用情况
        this.fightPoint = 0; // 总评分
        this.subProfession = '❓';
        this.attr = {};
    }

    /** 添加伤害记录
     * @param {number} skillId - 技能ID/Buff ID
     * @param {string} element - 技能元素属性
     * @param {number} damage - 伤害值
     * @param {boolean} isCrit - 是否为暴击
     * @param {boolean} [isLucky] - 是否为幸运
     * @param {boolean} [isCauseLucky] - 是否造成幸运
     * @param {number} hpLessenValue - 生命值减少量
     */
    addDamage(skillId, element, damage, isCrit, isLucky, isCauseLucky, hpLessenValue = 0) {
        this.damageStats.addRecord(damage, isCrit, isLucky, hpLessenValue);
        // 记录技能使用情况
        if (!this.skillUsage.has(skillId)) {
            this.skillUsage.set(skillId, new StatisticData(this, 'DMG', element));
        }
        this.skillUsage.get(skillId).addRecord(damage, isCrit, isCauseLucky, hpLessenValue);
        this.skillUsage.get(skillId).realtimeWindow.length = 0;

        const subProfession = getSubProfessionBySkillId(skillId);
        if (subProfession) {
            this.setSubProfession(subProfession);
        }
    }

    /** 添加治疗记录
     * @param {number} skillId - 技能ID/Buff ID
     * @param {string} element - 技能元素属性
     * @param {number} healing - 治疗值
     * @param {boolean} isCrit - 是否为暴击
     * @param {boolean} [isLucky] - 是否为幸运
     * @param {boolean} [isCauseLucky] - 是否造成幸运
     */
    addHealing(skillId, element, healing, isCrit, isLucky, isCauseLucky) {
        this.healingStats.addRecord(healing, isCrit, isLucky);
        // 记录技能使用情况
        skillId = skillId + 1000000000;
        if (!this.skillUsage.has(skillId)) {
            this.skillUsage.set(skillId, new StatisticData(this, 'Heal', element));
        }
        this.skillUsage.get(skillId).addRecord(healing, isCrit, isCauseLucky);
        this.skillUsage.get(skillId).realtimeWindow.length = 0;

        const subProfession = getSubProfessionBySkillId(skillId - 1000000000);
        if (subProfession) {
            this.setSubProfession(subProfession);
        }
    }

    /** 添加承伤记录
     * @param {number} damage - 承受的伤害值
     * @param {boolean} isDead - 是否致死伤害
     * */
    addTakenDamage(damage, isDead) {
        this.takenDamage += damage;
        if (isDead) this.deadCount++;
    }

    /** 更新实时DPS和HPS 计算过去1秒内的总伤害和治疗 */
    updateRealtimeDps() {
        this.damageStats.updateRealtimeStats();
        this.healingStats.updateRealtimeStats();
    }

    /** 计算总DPS */
    getTotalDps() {
        return this.damageStats.getTotalPerSecond();
    }

    /** 计算总HPS */
    getTotalHps() {
        return this.healingStats.getTotalPerSecond();
    }

    /** 获取合并的次数统计 */
    getTotalCount() {
        return {
            normal: this.damageStats.count.normal + this.healingStats.count.normal,
            critical: this.damageStats.count.critical + this.healingStats.count.critical,
            lucky: this.damageStats.count.lucky + this.healingStats.count.lucky,
            total: this.damageStats.count.total + this.healingStats.count.total,
        };
    }

    /** 获取用户数据摘要 */
    getSummary() {
        return {
            realtime_dps: this.damageStats.realtimeStats.value,
            realtime_dps_max: this.damageStats.realtimeStats.max,
            total_dps: this.getTotalDps(),
            total_damage: { ...this.damageStats.stats },
            total_count: this.getTotalCount(),
            realtime_hps: this.healingStats.realtimeStats.value,
            realtime_hps_max: this.healingStats.realtimeStats.max,
            total_hps: this.getTotalHps(),
            total_healing: { ...this.healingStats.stats },
            taken_damage: this.takenDamage,
            profession: this.profession + (this.subProfession ? `-${this.subProfession}` : ''),
            name: this.name,
            fightPoint: this.fightPoint,
            hp: this.attr.hp,
            max_hp: this.attr.max_hp,
            dead_count: this.deadCount,
        };
    }

    /** 获取技能统计数据 */
    getSkillSummary() {
        const skills = {};
        for (const [skillId, stat] of this.skillUsage) {
            const total = stat.stats.normal + stat.stats.critical + stat.stats.lucky + stat.stats.crit_lucky;
            const critCount = stat.count.critical;
            const luckyCount = stat.count.lucky;
            const critRate = stat.count.total > 0 ? critCount / stat.count.total : 0;
            const luckyRate = stat.count.total > 0 ? luckyCount / stat.count.total : 0;
            const name = skillConfig[skillId % 1000000000] ?? skillId % 1000000000;
            const elementype = stat.element;

            skills[skillId] = {
                displayName: name,
                type: stat.type,
                elementype: elementype,
                totalDamage: stat.stats.total,
                totalCount: stat.count.total,
                critCount: stat.count.critical,
                luckyCount: stat.count.lucky,
                critRate: critRate,
                luckyRate: luckyRate,
                damageBreakdown: { ...stat.stats },
                countBreakdown: { ...stat.count },
            };
        }
        return skills;
    }

    /** 设置职业
     * @param {string} profession - 职业名称
     * */
    setProfession(profession) {
        if (profession !== this.profession) this.setSubProfession('');
        this.profession = profession;
    }

    /** 设置子职业
     * @param {string} subProfession - 子职业名称
     * */
    setSubProfession(subProfession) {
        this.subProfession = subProfession;
    }

    /** 设置姓名
     * @param {string} name - 姓名
     * */
    setName(name) {
        this.name = name;
    }

    /** 设置用户总评分
     * @param {number} fightPoint - 总评分
     */
    setFightPoint(fightPoint) {
        this.fightPoint = fightPoint;
    }

    /** 设置额外数据
     * @param {string} key
     * @param {any} value
     */
    setAttrKV(key, value) {
        this.attr[key] = value;
    }

    /** 重置数据 预留 */
    reset() {
        this.damageStats.reset();
        this.healingStats.reset();
        this.takenDamage = 0;
        this.skillUsage.clear();
        this.fightPoint = 0;
    }
}

// 用户数据管理器
class UserDataManager {
    constructor(logger) {
        this.logger = logger;
        this.users = new Map();
        this.userCache = new Map(); // 用户名字和职业缓存
        this.cacheFilePath = './users.json';

        // 节流相关配置
        this.saveThrottleDelay = 2000; // 2秒节流延迟，避免频繁磁盘写入
        this.saveThrottleTimer = null;
        this.pendingSave = false;

        this.hpCache = new Map(); // 这个经常变化的就不存盘了
        this.startTime = Date.now();

        this.logLock = new Lock();
        this.logDirExist = new Set();

        this.enemyCache = {
            name: new Map(),
            hp: new Map(),
            maxHp: new Map(),
        };

        // 自动保存
        this.lastAutoSaveTime = 0;
        this.lastLogTime = 0;
        setInterval(() => {
            if (this.lastLogTime < this.lastAutoSaveTime) return;
            this.lastAutoSaveTime = Date.now();
            this.saveAllUserData();
        }, 10 * 1000);
    }

    /** 初始化方法 - 异步加载用户缓存 */
    async initialize() {
        // await this.loadUserCache();
    }

    /** 加载用户缓存 */
    async loadUserCache() {
        try {
            await fsPromises.access(this.cacheFilePath);
            const data = await fsPromises.readFile(this.cacheFilePath, 'utf8');
            const cacheData = JSON.parse(data);
            this.userCache = new Map(Object.entries(cacheData));
            this.logger.info(`Loaded ${this.userCache.size} user cache entries`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error('Failed to load user cache:', error);
            }
        }
    }

    /** 保存用户缓存 */
    async saveUserCache() {
        // try {
        //     const cacheData = Object.fromEntries(this.userCache);
        //     await fsPromises.writeFile(this.cacheFilePath, JSON.stringify(cacheData, null, 2), 'utf8');
        // } catch (error) {
        //     this.logger.error('Failed to save user cache:', error);
        // }
    }

    /** 节流保存用户缓存 - 减少频繁的磁盘写入 */
    saveUserCacheThrottled() {
        this.pendingSave = true;

        if (this.saveThrottleTimer) {
            clearTimeout(this.saveThrottleTimer);
        }

        this.saveThrottleTimer = setTimeout(async () => {
            if (this.pendingSave) {
                await this.saveUserCache();
                this.pendingSave = false;
                this.saveThrottleTimer = null;
            }
        }, this.saveThrottleDelay);
    }

    /** 强制立即保存用户缓存 - 用于程序退出等场景 */
    async forceUserCacheSave() {
        await this.saveAllUserData(this.users, this.startTime);
        if (this.saveThrottleTimer) {
            clearTimeout(this.saveThrottleTimer);
            this.saveThrottleTimer = null;
        }
        if (this.pendingSave) {
            await this.saveUserCache();
            this.pendingSave = false;
        }
    }

    /** 获取或创建用户记录
     * @param {number} uid - 用户ID
     * @returns {UserData} - 用户数据实例
     */
    getUser(uid) {
        if (!this.users.has(uid)) {
            const user = new UserData(uid);

            // 从缓存中设置名字和职业
            const cachedData = this.userCache.get(String(uid));
            if (cachedData) {
                // if (cachedData.name) {
                //     user.setName(cachedData.name);
                // }
                if (cachedData.profession) {
                    user.setProfession(cachedData.profession);
                }
                if (cachedData.fightPoint !== undefined && cachedData.fightPoint !== null) {
                    user.setFightPoint(cachedData.fightPoint);
                }
                if (cachedData.maxHp !== undefined && cachedData.maxHp !== null) {
                    user.setAttrKV('max_hp', cachedData.maxHp);
                }
            }
            if (this.hpCache.has(uid)) {
                user.setAttrKV('hp', this.hpCache.get(uid));
            }

            this.users.set(uid, user);
        }
        return this.users.get(uid);
    }

    /** 添加伤害记录
     * @param {number} uid - 造成伤害的用户ID
     * @param {number} skillId - 技能ID/Buff ID
     * @param {string} element - 技能元素属性
     * @param {number} damage - 伤害值
     * @param {boolean} isCrit - 是否为暴击
     * @param {boolean} [isLucky] - 是否为幸运
     * @param {boolean} [isCauseLucky] - 是否造成幸运
     * @param {number} hpLessenValue - 生命值减少量
     * @param {number} targetUid - 伤害目标ID
     */
    addDamage(uid, skillId, element, damage, isCrit, isLucky, isCauseLucky, hpLessenValue = 0, targetUid) {
        if (isPaused) return;
        if (globalSettings.onlyRecordEliteDummy && targetUid !== 75) return;
        this.checkTimeoutClear();
        const user = this.getUser(uid);
        user.addDamage(skillId, element, damage, isCrit, isLucky, isCauseLucky, hpLessenValue);
    }

    /** 添加治疗记录
     * @param {number} uid - 进行治疗的用户ID
     * @param {number} skillId - 技能ID/Buff ID
     * @param {string} element - 技能元素属性
     * @param {number} healing - 治疗值
     * @param {boolean} isCrit - 是否为暴击
     * @param {boolean} [isLucky] - 是否为幸运
     * @param {boolean} [isCauseLucky] - 是否造成幸运
     * @param {number} targetUid - 被治疗的用户ID
     */
    addHealing(uid, skillId, element, healing, isCrit, isLucky, isCauseLucky, targetUid) {
        if (isPaused) return;
        this.checkTimeoutClear();
        if (uid !== 0) {
            const user = this.getUser(uid);
            user.addHealing(skillId, element, healing, isCrit, isLucky, isCauseLucky);
        }
    }

    /** 添加承伤记录
     * @param {number} uid - 承受伤害的用户ID
     * @param {number} damage - 承受的伤害值
     * @param {boolean} isDead - 是否致死伤害
     * */
    addTakenDamage(uid, damage, isDead) {
        if (isPaused) return;
        this.checkTimeoutClear();
        const user = this.getUser(uid);
        user.addTakenDamage(damage, isDead);
    }

    /** 添加日志记录
     * @param {string} log - 日志内容
     * */
    async addLog(log) {
        if (isPaused) return;

        const logDir = path.join('./logs', String(this.startTime));
        const logFile = path.join(logDir, 'fight.log');
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${log}\n`;

        this.lastLogTime = Date.now();

        await this.logLock.acquire();
        try {
            if (!this.logDirExist.has(logDir)) {
                try {
                    await fsPromises.access(logDir);
                } catch (error) {
                    await fsPromises.mkdir(logDir, { recursive: true });
                }
                this.logDirExist.add(logDir);
            }
            await fsPromises.appendFile(logFile, logEntry, 'utf8');
        } catch (error) {
            this.logger.error('Failed to save log:', error);
        }
        this.logLock.release();
    }

    /** 设置用户职业
     * @param {number} uid - 用户ID
     * @param {string} profession - 职业名称
     * */
    setProfession(uid, profession) {
        const user = this.getUser(uid);
        if (user.profession !== profession) {
            user.setProfession(profession);
            // this.logger.info(`Found profession ${profession} for uid ${uid}`);

            // 更新缓存
            const uidStr = String(uid);
            if (!this.userCache.has(uidStr)) {
                this.userCache.set(uidStr, {});
            }
            this.userCache.get(uidStr).profession = profession;
            this.saveUserCacheThrottled();
        }
    }

    /** 设置用户姓名
     * @param {number} uid - 用户ID
     * @param {string} name - 姓名
     * */
    setName(uid, name) {
        const user = this.getUser(uid);
        this.logger.info(`Found player name ${name} for uid ${uid}`);
        if (user.name !== name) {
            user.setName(name);

            // 更新缓存
            const uidStr = String(uid);
            // if (!this.userCache.has(uidStr)) {
            //     this.userCache.set(uidStr, {});
            // }
            // this.userCache.get(uidStr).name = name;
            // this.saveUserCacheThrottled();
        }
    }

    /** 设置用户总评分
     * @param {number} uid - 用户ID
     * @param {number} fightPoint - 总评分
     */
    setFightPoint(uid, fightPoint) {
        const user = this.getUser(uid);
        if (user.fightPoint != fightPoint) {
            user.setFightPoint(fightPoint);
            // this.logger.info(`Found fight point ${fightPoint} for uid ${uid}`);

            // 更新缓存
            const uidStr = String(uid);
            if (!this.userCache.has(uidStr)) {
                this.userCache.set(uidStr, {});
            }
            this.userCache.get(uidStr).fightPoint = fightPoint;
            this.saveUserCacheThrottled();
        }
    }

    /** 设置额外数据
     * @param {number} uid - 用户ID
     * @param {string} key
     * @param {any} value
     */
    setAttrKV(uid, key, value) {
        const user = this.getUser(uid);
        user.attr[key] = value;

        if (key === 'max_hp') {
            // 更新缓存
            const uidStr = String(uid);
            if (!this.userCache.has(uidStr)) {
                this.userCache.set(uidStr, {});
            }
            this.userCache.get(uidStr).maxHp = value;
            this.saveUserCacheThrottled();
        }
        if (key === 'hp') {
            this.hpCache.set(uid, value);
        }
    }

    /** 更新所有用户的实时DPS和HPS */
    updateAllRealtimeDps() {
        for (const user of this.users.values()) {
            user.updateRealtimeDps();
        }
    }

    /** 获取用户的技能数据 */
    getUserSkillData(uid) {
        const user = this.users.get(uid);
        if (!user) return null;

        return {
            uid: user.uid,
            name: user.name,
            profession: user.profession + (user.subProfession ? `-${user.subProfession}` : ''),
            skills: user.getSkillSummary(),
            attr: user.attr,
        };
    }

    /** 获取所有用户数据 */
    getAllUsersData() {
        const result = {};
        for (const [uid, user] of this.users.entries()) {
            result[uid] = user.getSummary();
        }
        return result;
    }

    /** 获取所有敌方缓存数据 */
    getAllEnemiesData() {
        const result = {};
        const enemyIds = new Set([...this.enemyCache.name.keys(), ...this.enemyCache.hp.keys(), ...this.enemyCache.maxHp.keys()]);
        enemyIds.forEach((id) => {
            result[id] = {
                name: this.enemyCache.name.get(id),
                hp: this.enemyCache.hp.get(id),
                max_hp: this.enemyCache.maxHp.get(id),
            };
        });
        return result;
    }

    /** 移除敌方缓存数据 */
    deleteEnemyData(id) {
        this.enemyCache.name.delete(id);
        this.enemyCache.hp.delete(id);
        this.enemyCache.maxHp.delete(id);
    }

    /** 清空敌方缓存 */
    refreshEnemyCache() {
        this.enemyCache.name.clear();
        this.enemyCache.hp.clear();
        this.enemyCache.maxHp.clear();
    }

    /** 清除所有用户数据 */
    clearAll() {
        const usersToSave = this.users;
        const saveStartTime = this.startTime;
        this.users = new Map();
        this.startTime = Date.now();
        this.lastAutoSaveTime = 0;
        this.lastLogTime = 0;
        this.saveAllUserData(usersToSave, saveStartTime);
    }

    /** 获取用户列表 */
    getUserIds() {
        return Array.from(this.users.keys());
    }

    /** 保存所有用户数据到历史记录
     * @param {Map} usersToSave - 要保存的用户数据Map
     * @param {number} startTime - 数据开始时间
     */
    async saveAllUserData(usersToSave = null, startTime = null) {
        try {
            const endTime = Date.now();
            const users = usersToSave || this.users;
            const timestamp = startTime || this.startTime;
            const logDir = path.join('./logs', String(timestamp));
            const usersDir = path.join(logDir, 'users');
            const summary = {
                startTime: timestamp,
                endTime,
                duration: endTime - timestamp,
                userCount: users.size,
                version: VERSION,
            };

            const allUsersData = {};
            const userDatas = new Map();
            for (const [uid, user] of users.entries()) {
                allUsersData[uid] = user.getSummary();

                const userData = {
                    uid: user.uid,
                    name: user.name,
                    profession: user.profession + (user.subProfession ? `-${user.subProfession}` : ''),
                    skills: user.getSkillSummary(),
                    attr: user.attr,
                };
                userDatas.set(uid, userData);
            }

            try {
                await fsPromises.access(usersDir);
            } catch (error) {
                await fsPromises.mkdir(usersDir, { recursive: true });
            }

            // 保存所有用户数据汇总
            const allUserDataPath = path.join(logDir, 'allUserData.json');
            await fsPromises.writeFile(allUserDataPath, JSON.stringify(allUsersData, null, 2), 'utf8');

            // 保存每个用户的详细数据
            for (const [uid, userData] of userDatas.entries()) {
                const userDataPath = path.join(usersDir, `${uid}.json`);
                await fsPromises.writeFile(userDataPath, JSON.stringify(userData, null, 2), 'utf8');
            }

            await fsPromises.writeFile(path.join(logDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

            this.logger.debug(`Saved data for ${summary.userCount} users to ${logDir}`);
        } catch (error) {
            this.logger.error('Failed to save all user data:', error);
            throw error;
        }
    }

    checkTimeoutClear() {
        if (!globalSettings.autoClearOnTimeout || this.lastLogTime === 0 || this.users.size === 0) return;
        const currentTime = Date.now();
        if (this.lastLogTime && currentTime - this.lastLogTime > 15000) {
            this.clearAll();
            // this.logger.info('Timeout reached, statistics cleared!');
        }
    }

    getGlobalSettings() {
        return globalSettings;
    }
}

async function main() {
    print('Welcome to use Damage Counter for Star Resonance!');
    print(`Version: V${VERSION}`);
    print('GitHub: https://github.com/winjwinj/StarResonanceDamageCounter');
    for (let i = 0; i < devices.length; i++) {
        print(String(i).padStart(2, ' ') + '.' + (devices[i].description || devices[i].name));
    }

    // 从命令行参数获取设备号和日志级别
    const args = process.argv.slice(2);
    // let num = args[0]
    let num = args[0] ? args[0] : 'auto';
    let log_level = args[1] ? args[1] : 'info';

    if (num === 'auto') {
        print('Auto detecting default network interface...');
        const device_num = await findDefaultNetworkDevice(devices);
        if (device_num) {
            num = device_num;
            print(`Using network interface: ${num} - ${devices[num].description}`);
        } else {
            print('Default network interface not found!');
            num = undefined;
        }
    }

    // 参数验证函数
    function isValidLogLevel(level) {
        return ['info', 'debug'].includes(level);
    }

    // 如果命令行没传或者不合法，使用交互
    while (num === undefined || !devices[num]) {
        num = await ask('Please enter the number of the device to capture: ');
        if (!num) {
            print('Auto detecting default network interface...');
            const device_num = await findDefaultNetworkDevice(devices);
            if (device_num) {
                num = device_num;
                print(`Using network interface: ${num} - ${devices[num].description}`);
            } else {
                print('Default network interface not found!');
                num = undefined;
            }
        }
        if (!devices[num]) {
            print('Cannot find device ' + num + '!');
        }
    }
    while (log_level === undefined || !isValidLogLevel(log_level)) {
        log_level = (await ask('Please enter log level (info|debug): ')) || 'info';
        if (!isValidLogLevel(log_level)) {
            print('Invalid log level!');
        }
    }

    rl.close();
    const logger = winston.createLogger({
        level: log_level,
        format: winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf((info) => {
                return `[${info.timestamp}] [${info.level}] ${info.message}`;
            }),
        ),
        transports: [
            new winston.transports.Console(),
            new winston.transports.File({
                filename: "app.log",   // log file name
                level: log_level,      // optional: can set different level
            }),
        ],
    });

    const userDataManager = new UserDataManager(logger);

    // 异步初始化用户数据管理器
    await userDataManager.initialize();

    // 进程退出时保存用户缓存
    process.on('SIGINT', async () => {
        console.log('\nSaving user cache...');
        await userDataManager.forceUserCacheSave();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\nSaving user cache...');
        await userDataManager.forceUserCacheSave();
        process.exit(0);
    });

    //瞬时DPS更新
    setInterval(() => {
        if (!isPaused) {
            userDataManager.updateAllRealtimeDps();
        }
    }, 100);

    //express 和 socket.io 设置
    app.use(cors());
    app.use(express.json()); // 解析JSON请求体
    app.use(express.static(path.join(__dirname, 'public'))); // 静态文件服务
    const server = http.createServer(app);
    const io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
        },
    });

    app.get('/api/data', (req, res) => {
        const userData = userDataManager.getAllUsersData();
        const data = {
            code: 0,
            user: userData,
        };
        res.json(data);
    });

    app.get('/api/enemies', (req, res) => {
        const enemiesData = userDataManager.getAllEnemiesData();
        const data = {
            code: 0,
            enemy: enemiesData,
        };
        res.json(data);
    });

    app.get('/api/clear', (req, res) => {
        userDataManager.clearAll();
        logger.info('Statistics have been cleared!');
        res.json({
            code: 0,
            msg: 'Statistics have been cleared!',
        });
    });

    // 暂停/开始统计API
    app.post('/api/pause', (req, res) => {
        const { paused } = req.body;
        isPaused = paused;
        logger.info(`Statistics ${isPaused ? 'paused' : 'resumed'}!`);
        res.json({
            code: 0,
            msg: `Statistics ${isPaused ? 'paused' : 'resumed'}!`,
            paused: isPaused,
        });
    });

    // 获取暂停状态API
    app.get('/api/pause', (req, res) => {
        res.json({
            code: 0,
            paused: isPaused,
        });
    });

    // 获取技能数据
    app.get('/api/skill/:uid', (req, res) => {
        const uid = parseInt(req.params.uid);
        const skillData = userDataManager.getUserSkillData(uid);

        if (!skillData) {
            return res.status(404).json({
                code: 1,
                msg: 'User not found',
            });
        }

        res.json({
            code: 0,
            data: skillData,
        });
    });

    // 历史数据概览
    app.get('/api/history/:timestamp/summary', async (req, res) => {
        const { timestamp } = req.params;
        const historyFilePath = path.join('./logs', timestamp, 'summary.json');

        try {
            const data = await fsPromises.readFile(historyFilePath, 'utf8');
            const summaryData = JSON.parse(data);
            res.json({
                code: 0,
                data: summaryData,
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('History summary file not found:', error);
                res.status(404).json({
                    code: 1,
                    msg: 'History summary file not found',
                });
            } else {
                logger.error('Failed to read history summary file:', error);
                res.status(500).json({
                    code: 1,
                    msg: 'Failed to read history summary file',
                });
            }
        }
    });

    // 历史数据
    app.get('/api/history/:timestamp/data', async (req, res) => {
        const { timestamp } = req.params;
        const historyFilePath = path.join('./logs', timestamp, 'allUserData.json');

        try {
            const data = await fsPromises.readFile(historyFilePath, 'utf8');
            const userData = JSON.parse(data);
            res.json({
                code: 0,
                user: userData,
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('History data file not found:', error);
                res.status(404).json({
                    code: 1,
                    msg: 'History data file not found',
                });
            } else {
                logger.error('Failed to read history data file:', error);
                res.status(500).json({
                    code: 1,
                    msg: 'Failed to read history data file',
                });
            }
        }
    });

    // 获取历史技能数据
    app.get('/api/history/:timestamp/skill/:uid', async (req, res) => {
        const { timestamp, uid } = req.params;
        const historyFilePath = path.join('./logs', timestamp, 'users', `${uid}.json`);

        try {
            const data = await fsPromises.readFile(historyFilePath, 'utf8');
            const skillData = JSON.parse(data);
            res.json({
                code: 0,
                data: skillData,
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('History skill file not found:', error);
                res.status(404).json({
                    code: 1,
                    msg: 'History skill file not found',
                });
            } else {
                logger.error('Failed to read history skill file:', error);
                res.status(500).json({
                    code: 1,
                    msg: 'Failed to read history skill file',
                });
            }
        }
    });

    // 下载历史战斗日志数据
    app.get('/api/history/:timestamp/download', async (req, res) => {
        const { timestamp } = req.params;
        const historyFilePath = path.join('./logs', timestamp, 'fight.log');
        res.download(historyFilePath, `fight_${timestamp}.log`);
    });

    // 历史数据列表
    app.get('/api/history/list', async (req, res) => {
        try {
            const data = (await fsPromises.readdir('./logs', { withFileTypes: true }))
                .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
                .map((e) => e.name);
            res.json({
                code: 0,
                data: data,
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('History path not found:', error);
                res.status(404).json({
                    code: 1,
                    msg: 'History path not found',
                });
            } else {
                logger.error('Failed to load history path:', error);
                res.status(500).json({
                    code: 1,
                    msg: 'Failed to load history path',
                });
            }
        }
    });

    // 设置相关接口
    app.get('/api/settings', async (req, res) => {
        res.json({ code: 0, data: globalSettings });
    });

    app.post('/api/settings', async (req, res) => {
        const newSettings = req.body;
        globalSettings = { ...globalSettings, ...newSettings };
        await fsPromises.writeFile(SETTINGS_PATH, JSON.stringify(globalSettings, null, 2), 'utf8');
        res.json({ code: 0, data: globalSettings });
    });

    try {
        await fsPromises.access(SETTINGS_PATH);
        const data = await fsPromises.readFile(SETTINGS_PATH, 'utf8');
        globalSettings = { ...globalSettings, ...JSON.parse(data) };
    } catch (e) {
        if (e.code !== 'ENOENT') {
            logger.error('Failed to load settings:', e);
        }
    }

    const clearDataOnServerChange = () => {
        userDataManager.refreshEnemyCache();
        if (!globalSettings.autoClearOnServerChange || userDataManager.lastLogTime === 0 || userDataManager.users.size === 0) return;
        userDataManager.clearAll();
        logger.info('Server changed, statistics cleared!');
    };

    // WebSocket 连接处理
    io.on('connection', (socket) => {
        logger.info('WebSocket client connected: ' + socket.id);

        socket.on('disconnect', () => {
            logger.info('WebSocket client disconnected: ' + socket.id);
        });
    });

    // 每100ms广播数据给所有WebSocket客户端
    setInterval(() => {
        if (!isPaused) {
            const userData = userDataManager.getAllUsersData();
            const data = {
                code: 0,
                user: userData,
            };
            io.emit('data', data);
        }
    }, 100);

    const checkPort = (port) => {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => {
                server.close(() => resolve(true));
            });
            server.listen(port);
        });
    };
    let server_port = 8989;
    while (true) {
        if (await checkPort(server_port)) break;
        logger.warn(`port ${server_port} is already in use`);
        server_port++;
    }
    server.listen(server_port, () => {
        // 自动用默认浏览器打开网页（跨平台兼容）
        const url = 'http://localhost:' + server_port;
        logger.info(`Web Server started at ${url}`);
        logger.info('WebSocket Server started');

        let command;
        switch (process.platform) {
            case 'darwin': // macOS
                command = `open ${url}`;
                break;
            case 'win32': // Windows
                command = `start ${url}`;
                break;
            default: // Linux 和其他 Unix-like 系统
                command = `xdg-open ${url}`;
                break;
        }

        exec(command, (error) => {
            if (error) {
                logger.error(`Failed to open browser: ${error.message}`);
            }
        });
    });

    logger.info('Welcome!');
    logger.info('Attempting to find the game server, please wait!');

    let current_server = '';
    let _data = Buffer.alloc(0);
    let tcp_next_seq = -1;
    let tcp_cache = new Map();
    let tcp_last_time = 0;
    const tcp_lock = new Lock();

    const clearTcpCache = () => {
        _data = Buffer.alloc(0);
        tcp_next_seq = -1;
        tcp_last_time = 0;
        tcp_cache.clear();
    };

    const fragmentIpCache = new Map();
    const FRAGMENT_TIMEOUT = 30000;
    const getTCPPacket = (frameBuffer, ethOffset) => {
        const ipPacket = decoders.IPV4(frameBuffer, ethOffset);
        const ipId = ipPacket.info.id;
        const isFragment = (ipPacket.info.flags & 0x1) !== 0;
        const _key = `${ipId}-${ipPacket.info.srcaddr}-${ipPacket.info.dstaddr}-${ipPacket.info.protocol}`;
        const now = Date.now();

        if (isFragment || ipPacket.info.fragoffset > 0) {
            if (!fragmentIpCache.has(_key)) {
                fragmentIpCache.set(_key, {
                    fragments: [],
                    timestamp: now,
                });
            }

            const cacheEntry = fragmentIpCache.get(_key);
            const ipBuffer = Buffer.from(frameBuffer.subarray(ethOffset));
            cacheEntry.fragments.push(ipBuffer);
            cacheEntry.timestamp = now;

            // there's more fragment ip packetm, wait for the rest
            if (isFragment) {
                return null;
            }

            // last fragment received, reassemble
            const fragments = cacheEntry.fragments;
            if (!fragments) {
                logger.error(`Can't find fragments for ${_key}`);
                return null;
            }

            // Reassemble fragments based on their offset
            let totalLength = 0;
            const fragmentData = [];

            // Collect fragment data with their offsets
            for (const buffer of fragments) {
                const ip = decoders.IPV4(buffer);
                const fragmentOffset = ip.info.fragoffset * 8;
                const payloadLength = ip.info.totallen - ip.hdrlen;
                const payload = Buffer.from(buffer.subarray(ip.offset, ip.offset + payloadLength));

                fragmentData.push({
                    offset: fragmentOffset,
                    payload: payload,
                });

                const endOffset = fragmentOffset + payloadLength;
                if (endOffset > totalLength) {
                    totalLength = endOffset;
                }
            }

            const fullPayload = Buffer.alloc(totalLength);
            for (const fragment of fragmentData) {
                fragment.payload.copy(fullPayload, fragment.offset);
            }

            fragmentIpCache.delete(_key);
            return fullPayload;
        }

        return Buffer.from(frameBuffer.subarray(ipPacket.offset, ipPacket.offset + (ipPacket.info.totallen - ipPacket.hdrlen)));
    };

    //抓包相关
    const eth_queue = [];
    const c = new Cap();
    const device = devices[num].name;
    const filter = 'ip and tcp';
    const bufSize = 10 * 1024 * 1024;
    const buffer = Buffer.alloc(65535);
    const linkType = c.open(device, filter, bufSize, buffer);
    if (linkType !== 'ETHERNET') {
        logger.error('The device seems to be WRONG! Please check the device! Device type: ' + linkType);
    }
    c.setMinBytes && c.setMinBytes(0);
    c.on('packet', async function (nbytes, trunc) {
        eth_queue.push(Buffer.from(buffer.subarray(0, nbytes)));
    });
    const processEthPacket = async (frameBuffer) => {
        // logger.debug('packet: length ' + nbytes + ' bytes, truncated? ' + (trunc ? 'yes' : 'no'));

        var ethPacket = decoders.Ethernet(frameBuffer);

        if (ethPacket.info.type !== PROTOCOL.ETHERNET.IPV4) return;

        const ipPacket = decoders.IPV4(frameBuffer, ethPacket.offset);
        const srcaddr = ipPacket.info.srcaddr;
        const dstaddr = ipPacket.info.dstaddr;

        const tcpBuffer = getTCPPacket(frameBuffer, ethPacket.offset);
        if (tcpBuffer === null) return;
        const tcpPacket = decoders.TCP(tcpBuffer);

        const tcp_payload = Buffer.from(tcpBuffer.subarray(tcpPacket.hdrlen));

        //logger.debug(' from port: ' + tcpPacket.info.srcport + ' to port: ' + tcpPacket.info.dstport);
        const srcport = tcpPacket.info.srcport;
        const dstport = tcpPacket.info.dstport;
        const src_server = srcaddr + ':' + srcport + ' -> ' + dstaddr + ':' + dstport;

        await tcp_lock.acquire();
        if (current_server !== src_server) {
            try {
                //尝试通过小包识别服务器
                if (tcp_payload[4] == 0) {
                    const data = tcp_payload.subarray(10);
                    if (data.length) {
                        const stream = Readable.from(data, { objectMode: false });
                        let tcp_frag;
                        do {
                            const tcp_frag_len = stream.read(4);
                            if (!tcp_frag_len) break;
                            tcp_frag = stream.read(tcp_frag_len.readUInt32BE() - 4);
                            const signature = Buffer.from([0x00, 0x63, 0x33, 0x53, 0x42, 0x00]); //c3SB??
                            if (Buffer.compare(tcp_frag.subarray(5, 5 + signature.length), signature)) break;
                            try {
                                if (current_server !== src_server) {
                                    current_server = src_server;
                                    clearTcpCache();
                                    tcp_next_seq = tcpPacket.info.seqno + tcp_payload.length;
                                    clearDataOnServerChange();
                                    logger.info('Got Scene Server Address: ' + src_server);
                                }
                            } catch (e) {}
                        } while (tcp_frag && tcp_frag.length);
                    }
                }
                //尝试通过登录返回包识别服务器(仍需测试)
                if (tcp_payload.length === 0x62) {
                    // prettier-ignore
                    const signature = Buffer.from([
                        0x00, 0x00, 0x00, 0x62,
                        0x00, 0x03,
                        0x00, 0x00, 0x00, 0x01,
                        0x00, 0x11, 0x45, 0x14,//seq?
                        0x00, 0x00, 0x00, 0x00,
                        0x0a, 0x4e, 0x08, 0x01, 0x22, 0x24
                    ]);
                    if (
                        Buffer.compare(tcp_payload.subarray(0, 10), signature.subarray(0, 10)) === 0 &&
                        Buffer.compare(tcp_payload.subarray(14, 14 + 6), signature.subarray(14, 14 + 6)) === 0
                    ) {
                        if (current_server !== src_server) {
                            current_server = src_server;
                            clearTcpCache();
                            tcp_next_seq = tcpPacket.info.seqno + tcp_payload.length;
                            clearDataOnServerChange();
                            logger.info('Got Scene Server Address by Login Return Packet: ' + src_server);
                        }
                    }
                }
            } catch (e) {}
            tcp_lock.release();
            return;
        }
        // logger.debug(`packet seq ${tcpPacket.info.seqno >>> 0} size ${buf.length} expected next seq ${((tcpPacket.info.seqno >>> 0) + buf.length) >>> 0}`);
        //这里已经是识别到的服务器的包了
        if (tcp_next_seq === -1) {
            logger.error('Unexpected TCP capture error! tcp_next_seq is -1');
            if (tcp_payload.length > 4 && tcp_payload.readUInt32BE() < 0x0fffff) {
                tcp_next_seq = tcpPacket.info.seqno;
            }
        }
        // logger.debug('TCP next seq: ' + tcp_next_seq);
        if ((tcp_next_seq - tcpPacket.info.seqno) << 0 <= 0 || tcp_next_seq === -1) {
            tcp_cache.set(tcpPacket.info.seqno, tcp_payload);
        }
        while (tcp_cache.has(tcp_next_seq)) {
            const seq = tcp_next_seq;
            const cachedTcpData = tcp_cache.get(seq);
            _data = _data.length === 0 ? cachedTcpData : Buffer.concat([_data, cachedTcpData]);
            tcp_next_seq = (seq + cachedTcpData.length) >>> 0; //uint32
            tcp_cache.delete(seq);
            tcp_last_time = Date.now();
        }

        while (_data.length > 4) {
            let packetSize = _data.readUInt32BE();

            if (_data.length < packetSize) break;

            if (_data.length >= packetSize) {
                const packet = _data.subarray(0, packetSize);
                _data = _data.subarray(packetSize);
                const processor = new PacketProcessor({ logger, userDataManager });
                logger.info(`Reassembled: Seq - ${packetSize} - ${packet}`)
                processor.processPacket(packet, 0); // TODO: this?
            } else if (packetSize > 0x0fffff) {
                // logger.error(`Invalid Length!! ${_data.length},${len},${_data.toString('hex')},${tcp_next_seq}`);
                process.exit(1);
                break;
            }
        }
        tcp_lock.release();
    };
    (async () => {
        while (true) {
            if (eth_queue.length) {
                const pkt = eth_queue.shift();
                processEthPacket(pkt);
            } else {
                await new Promise((r) => setTimeout(r, 1));
            }
        }
    })();

    //定时清理过期的IP分片缓存
    setInterval(async () => {
        const now = Date.now();
        let clearedFragments = 0;
        for (const [key, cacheEntry] of fragmentIpCache) {
            if (now - cacheEntry.timestamp > FRAGMENT_TIMEOUT) {
                fragmentIpCache.delete(key);
                clearedFragments++;
            }
        }
        if (clearedFragments > 0) {
            logger.debug(`Cleared ${clearedFragments} expired IP fragment caches`);
        }

        if (tcp_last_time && Date.now() - tcp_last_time > FRAGMENT_TIMEOUT) {
            logger.warn('Cannot capture the next packet! Is the game closed or disconnected? seq: ' + tcp_next_seq);
            current_server = '';
            clearTcpCache();
        }
    }, 10000);
}

if (!zlib.zstdDecompressSync) {
    // 之前总是有人用旧版本nodejs，不看警告还说数据不准，现在干脆不让旧版用算了
    // 还有人对着开源代码写闭源，不遵守许可就算了，还要诋毁开源，什么人啊这是
    print('zstdDecompressSync is not available! Please update your Node.js!');
    process.exit(1);
}

main();

// let v = [0, 0, 81, 185, 128, 6, 0, 0, 0, 1, 40, 181, 47, 253, 0, 88, 28, 141, 2, 26, 236, 243, 219, 84, 32, 14, 37, 149, 116, 93, 213, 76, 87, 81, 17, 17, 85, 101, 6, 20, 173, 6, 0, 85, 0, 0, 51, 25, 179, 168, 168, 170, 170, 5, 1, 17, 0, 193, 205, 198, 194, 182, 56, 118, 227, 163, 78, 170, 78, 142, 219, 226, 242, 118, 43, 103, 76, 219, 82, 63, 125, 165, 191, 112, 57, 67, 183, 120, 31, 146, 122, 154, 239, 165, 245, 5, 88, 101, 61, 75, 99, 187, 37, 178, 27, 33, 100, 183, 72, 14, 79, 14, 246, 12, 248, 29, 108, 100, 25, 74, 91, 166, 202, 31, 42, 165, 140, 115, 157, 198, 81, 195, 123, 242, 91, 90, 229, 136, 43, 42, 50, 1, 190, 161, 9, 240, 29, 23, 233, 139, 242, 4, 181, 165, 172, 193, 117, 90, 131, 38, 28, 65, 232, 110, 44, 45, 143, 85, 146, 240, 145, 36, 71, 224, 59, 29, 1, 23, 127, 72, 109, 136, 91, 114, 7, 215, 233, 14, 140, 134, 154, 198, 168, 100, 224, 104, 203, 34, 190, 161, 69, 124, 39, 39, 134, 171, 5, 145, 178, 33, 44, 59, 186, 156, 175, 211, 249, 29, 204, 142, 110, 68, 189, 200, 40, 92, 167, 81, 80, 223, 248, 242, 203, 117, 250, 101, 112, 5, 186, 196, 197, 15, 164, 165, 229, 73, 149, 36, 124, 236, 229, 12, 223, 233, 12, 239, 32, 39, 134, 43, 9, 138, 101, 150, 169, 96, 30, 45, 173, 114, 132, 22, 24, 89, 230, 27, 90, 230, 59, 57, 33, 154, 198, 232, 4, 143, 44, 177, 242, 132, 30, 42, 114, 9, 207, 208, 37, 28, 39, 71, 101, 18, 214, 130, 106, 73, 175, 110, 105, 149, 63, 84, 48, 242, 7, 215, 233, 15, 88, 236, 177, 48, 210, 97, 152, 121, 174, 211, 60, 239, 144, 115, 148, 83, 161, 4, 197, 140, 159, 16, 77, 99, 127, 127, 116, 75, 84, 105, 66, 29, 86, 54, 192, 117, 218, 0, 204, 64, 174, 52, 162, 33, 75, 10, 40, 127, 168, 6, 115, 6, 215, 233, 12, 132, 122, 48, 185, 216, 79, 136, 24, 124, 128, 56, 2, 151, 86, 89, 162, 206, 73, 174, 185, 78, 215, 188, 67, 142, 49, 9, 201, 203, 2, 69, 128, 201, 79, 136, 166, 179, 24, 98, 90, 150, 70, 229, 15, 85, 140, 156, 194, 117, 58, 133, 119, 200, 81, 153, 220, 80, 138, 64, 220, 79, 136, 166, 177, 41, 42, 96, 75, 171, 60, 161, 135, 94, 6, 113, 157, 6, 241, 14, 57, 49, 92, 73, 69, 98, 144, 33, 74, 65, 89, 90, 37, 9, 39, 93, 70, 94, 167, 145, 239, 144, 147, 124, 102, 123, 26, 171, 182, 167, 217, 194, 38, 172, 240, 145, 95, 126, 251, 229, 24, 199, 112, 33, 13, 94, 234, 39, 68, 147, 216, 87, 217, 218, 178, 149, 214, 143, 44, 107, 184, 78, 107, 120, 135, 22, 254, 161, 91, 184, 8, 56, 249, 204, 198, 27, 219, 248, 35, 182, 137, 25, 230, 48, 13, 115, 25, 124, 164, 3, 162, 228, 139, 134, 96, 94, 192, 1, 208, 11, 0, 194, 151, 114, 177, 5, 102, 5, 28, 0, 173, 128, 247, 228, 28, 233, 216, 242, 44, 179, 232, 66, 209, 3, 69, 21, 138, 22, 41, 13, 66, 129, 80, 20, 253, 132, 104, 42, 251, 139, 26, 178, 180, 74, 213, 139, 232, 40, 39, 224, 0, 232, 4, 188, 39, 199, 132, 21, 62, 242, 241, 22, 169, 143, 183, 48, 240, 142, 21, 18, 138, 32, 138, 61, 45, 8, 129, 132, 28, 22, 54, 144, 1, 19, 52, 128, 133, 19, 100, 160, 4, 57, 47, 36, 123, 245, 59, 13, 206, 32, 71, 197, 82, 97, 161, 84, 44, 21, 86, 169, 215, 207, 88, 36, 52, 5, 46, 136, 208, 128, 6, 62, 140, 48, 194, 82, 68, 11, 41, 68, 8, 192, 7, 41, 2, 144, 194, 231, 131, 16, 82, 164, 8, 225, 3, 17, 68, 44, 51, 240, 193, 82, 3, 1, 208, 128, 6, 150, 1, 88, 129, 131, 7, 224, 138, 43, 172, 62, 235, 178, 231, 135, 9, 200, 100, 50, 153, 56, 64, 182, 88, 232, 176, 193, 0, 254, 102, 135, 65, 9, 20, 16, 197, 192, 36, 109, 214, 91, 27, 54, 54, 113, 40, 220, 117, 90, 169, 80, 129, 142, 137, 16, 33, 194, 8, 32, 60, 44, 61, 44, 147, 232, 215, 218, 2, 133, 90, 122, 8, 192, 210, 103, 4, 16, 30, 62, 120, 88, 190, 160, 76, 40, 243, 197, 22, 26, 173, 20, 163, 237, 59, 218, 60, 36, 141, 46, 246, 89, 108, 212, 166, 216, 104, 219, 99, 27, 103, 173, 101, 43, 186, 80, 244, 128, 106, 117, 88, 59, 134, 218, 174, 162, 189, 178, 71, 173, 212, 117, 90, 169, 88, 178, 70, 215, 105, 68, 38, 197, 50, 79, 224, 97, 1, 18, 108, 96, 116, 1, 93, 154, 160, 4, 44, 152, 64, 237, 73, 192, 83, 146, 82, 4, 16, 34, 128, 8, 65, 68, 136, 16, 66, 92, 32, 196, 139, 237, 234, 4, 60, 37, 29, 165, 17, 133, 49, 48, 131, 81, 44, 42, 157, 195, 138, 207, 224, 125, 38, 135, 242, 32, 96, 160, 31, 159, 229, 133, 131, 123, 74, 228, 185, 109, 77, 86, 48, 55, 240, 158, 184, 30, 159, 241, 113, 156, 50, 35, 216, 103, 180, 78, 131, 125, 150, 87, 71, 215, 145, 57, 158, 155, 3, 134, 146, 28, 191, 193, 62, 77, 20, 51, 137, 99, 99, 43, 108, 200, 141, 253, 92, 103, 11, 24, 72, 72, 198, 136, 190, 147, 116, 242, 153, 180, 231, 109, 50, 109, 129, 249, 14, 211, 57, 32, 126, 134, 232, 52, 248, 231, 58, 229, 154, 124, 156, 70, 137, 207, 117, 163, 107, 194, 76, 115, 255, 131, 41, 20, 96, 124, 134, 234, 44, 85, 114, 130, 174, 104, 26, 154, 2, 186, 206, 171, 193, 166, 159, 235, 164, 81, 200, 195, 231, 58, 105, 248, 157, 45, 229, 238, 1, 199, 24, 161, 80, 215, 224, 174, 221, 145, 184, 36, 215, 113, 59, 14, 126, 158, 230, 237, 10, 29, 223, 57, 200, 68, 125, 102, 195, 65, 208, 114, 157, 156, 67, 205, 12, 192, 122, 14, 94, 94, 183, 35, 34, 173, 85, 202, 53, 128, 57, 128, 2, 151, 1, 8, 92, 77, 19, 238, 24, 4, 116, 157, 101, 86, 224, 126, 124, 174, 19, 74, 13, 46, 241, 61, 88, 189, 67, 161, 74, 1, 84, 147, 60, 213, 34, 99, 234, 155, 146, 186, 3, 48, 137, 102, 52, 45, 238, 32, 176, 3, 198, 122, 168, 137, 84, 210, 92, 121, 52, 209, 168, 38, 6, 65, 215, 41, 232, 39, 232, 212, 252, 185, 110, 131, 87, 88, 136, 52, 239, 51, 119, 28, 108, 93, 60, 147, 79, 74, 84, 48, 249, 158, 131, 37, 80, 199, 98, 72, 225, 55, 232, 56, 14, 94, 94, 49, 60, 184, 39, 142, 45, 146, 113, 116, 14, 106, 167, 161, 178, 113, 26, 236, 179, 188, 104, 125, 130, 76, 158, 139, 214, 103, 4, 80, 132, 222, 111, 240, 207, 125, 99, 10, 6, 57, 77, 86, 90, 219, 113, 146, 119, 232, 210, 103, 112, 6, 39, 99, 105, 16, 208, 117, 166, 145, 141, 253, 248, 92, 103, 12, 30, 99, 203, 43, 149, 200, 132, 137, 243, 14, 216, 103, 121, 215, 218, 184, 204, 241, 92, 31, 96, 43, 212, 126, 83, 87, 247, 25, 252, 115, 225, 212, 248, 156, 62, 99, 118, 154, 53, 160, 31, 31, 13, 255, 0, 3, 165, 208, 227, 55, 88, 45, 91, 75, 217, 152, 40, 221, 218, 49, 104, 200, 123, 48, 6, 46, 152, 40, 124, 84, 124, 3, 206, 106, 159, 193, 63, 215, 9, 5, 72, 219, 105, 128, 154, 109, 79, 254, 97, 235, 52, 47, 206, 1, 255, 220, 183, 102, 219, 220, 105, 112, 6, 165, 98, 26, 4, 116, 157, 87, 186, 48, 127, 124, 174, 27, 93, 162, 18, 250, 13, 124, 159, 185, 87, 231, 128, 5, 227, 78, 163, 197, 104, 230, 31, 120, 157, 6, 255, 92, 39, 29, 142, 181, 211, 224, 212, 176, 153, 30, 245, 161, 81, 205, 99, 208, 229, 222, 115, 162, 203, 103, 132, 156, 67, 145, 207, 96, 186, 211, 92, 161, 187, 66, 119, 133, 238, 10, 29, 4, 146, 124, 9, 244, 115, 225, 212, 246];
// const processor = new PacketProcessor({});
// processor.processPacket(Buffer.from(v), 0);