"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
dotenv_1.default.config();
const pg_1 = require("pg");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const console_1 = require("console");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.ORIGIN,
    credentials: true
}));
app.listen(process.env.PORT);
const connectionString = process.env.DATABASE_URL;
const client = new pg_1.Client({ connectionString, ssl: { rejectUnauthorized: false } });
client.connect();
app.get('/', (req, res) => {
    res.status(200).send("hello");
});
app.post('/api/authenticate', (req, res) => {
    // TODO: hash passwords //
    //////////////////////////
    const { mail, password, rememberMe } = req.body;
    client
        .query(`select * from users where mail = $1`, [mail])
        .then(dbres => {
        if (dbres.rowCount === 0 || dbres.rows[0]['password'] !== password) {
            res.status(200).json({ authenticated: false, message: 'Authentication failed' });
        }
        else {
            const user = dbres.rows[0];
            delete user.password;
            const token = jsonwebtoken_1.default.sign(user, process.env.SECRET, { expiresIn: rememberMe ? "30d" : "10m" });
            res
                .status(200)
                .cookie("authtoken", token, {
                httpOnly: true,
                sameSite: false,
                secure: true,
                maxAge: rememberMe ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 10,
            })
                .json({ authenticated: true, role: user.role, message: 'Authentication successful' });
        }
    })
        .catch(err => {
        console.error(err);
    });
});
// middleware verification function
const cookieJwtAuth = (req, res, next) => {
    const token = req.cookies.authtoken;
    try {
        jsonwebtoken_1.default.verify(token, process.env.SECRET);
        next();
    }
    catch (err) {
        res.clearCookie(token);
        res.status(401).json({ error: "invalid token" });
    }
};
app.get('/api/products', (req, res) => {
    client
        .query("select * from products order by id;")
        .then(dbres => {
        res.status(200).json(dbres.rows);
    })
        .catch(err => {
        console.error(err);
    });
});
function insertDaysIntoDB(month) {
    return __awaiter(this, void 0, void 0, function* () {
        const currentDate = new Date(Date.UTC(new Date().getFullYear(), month, 1));
        while (currentDate.getMonth() == month) {
            yield client.query("insert into days values($1,$2,$3,$4,$5);", [currentDate.toISOString().split('T')[0], 3, 3, false, '']);
            currentDate.setDate(currentDate.getDate() + 1);
        }
    });
}
;
app.get('/api/days/:month', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const month = +req.params.month;
    const year = new Date().getFullYear();
    const firstDay = new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    yield client
        .query("select day from days order by day desc limit 1;")
        .then((dbres) => __awaiter(void 0, void 0, void 0, function* () {
        if (dbres.rowCount == 0) {
            console.log("adding days to table");
            yield insertDaysIntoDB(month);
        }
        else if (dbres.rows[0].day.getMonth() < month) {
            console.log("adding days to table");
            yield insertDaysIntoDB(month);
        }
        ;
    }))
        .catch(err => {
        console.error(err);
    });
    yield client
        .query("select * from days where day >= $1 and day <= $2 order by day;", [firstDay, lastDay])
        .then(dbres => {
        res.status(200).json(dbres.rows.map(row => {
            const dbdate = row.day;
            row.day = new Date(Date.UTC(dbdate.getFullYear(), dbdate.getMonth(), dbdate.getDate()));
            return row;
        }));
    })
        .catch(err => {
        console.error(err);
    });
}));
;
app.post('/api/submit_order', cookieJwtAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    // TODO deposit management
    const user = jsonwebtoken_1.default.decode(req.cookies.authtoken);
    const { order_deadline, preparation_time, price, details, note } = req.body;
    let currentDate = new Date();
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    currentDate.setMinutes(currentDate.getMinutes() - currentDate.getTimezoneOffset());
    if (new Date().getHours() > 16)
        currentDate.setDate(currentDate.getDate() + 1);
    const tmp = new Date(order_deadline);
    tmp.setDate(new Date(order_deadline).getDate() - 3);
    const earliestDateToStartProducing = new Date(Math.max(currentDate.getTime(), tmp.getTime()));
    let days = [];
    let available_wrkld = 0;
    let leftWorkToAssign = preparation_time;
    console.log(earliestDateToStartProducing, order_deadline);
    yield client
        .query("begin")
        .then(() => __awaiter(void 0, void 0, void 0, function* () {
        yield client
            .query("select * from days where day > $1 and day <= $2 order by day desc", [earliestDateToStartProducing, order_deadline])
            .then(dbres => {
            days = dbres.rows;
            console.log(days);
            days.map(day => { available_wrkld += day.available_wrkld; });
            if (available_wrkld < preparation_time)
                throw (0, console_1.error)("Nedostatok casu na vyrobu");
        });
    }))
        .then(() => __awaiter(void 0, void 0, void 0, function* () {
        for (let day of days) {
            const sub = Math.min(day.available_wrkld, leftWorkToAssign);
            //console.log(day.day);
            yield client
                .query("update days set available_wrkld = $1 where day = $2", [day.available_wrkld - sub, day.day.toISOString().split('T')[0]])
                .then(() => { leftWorkToAssign -= sub; });
        }
    }))
        .then(() => __awaiter(void 0, void 0, void 0, function* () {
        const d = new Date();
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        yield client
            .query("insert into orders (user_id, status, order_time, order_deadline, preparation_time, price, paid, details, note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9);", [user.id, "pending", d, order_deadline, preparation_time, price, 0, details, note]);
    }))
        .then(() => __awaiter(void 0, void 0, void 0, function* () {
        yield client
            .query("commit;");
    }))
        .catch((err) => {
        console.error('Error executing transaction:', err);
        client.query('rollback;')
            .then(() => {
            console.log('Transaction rolled back');
        })
            .catch((rollbackErr) => {
            console.error('Error rolling back transaction:', rollbackErr);
            client.end();
        });
        res.status(500).send();
    });
    res.status(200).send();
}));
app.get('/api/orders', cookieJwtAuth, (req, res) => {
    const user = jsonwebtoken_1.default.decode(req.cookies.authtoken);
    client
        .query("select id, status, order_time, order_deadline, deposit_deadline, price, paid, details, note from orders where user_id = $1;", [user.id])
        .then(dbres => {
        res.status(200).json(dbres.rows);
    })
        .catch(err => {
        console.error(err);
        res.status(500).send();
    });
});