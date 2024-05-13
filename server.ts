import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
dotenv.config();
import pkg from 'pg';
const { Client } = pkg;
import jwt, { Secret } from 'jsonwebtoken';
import { error } from 'console';
import AdminJS from 'adminjs';
import AdminJSExpress from '@adminjs/express';
import Connect from 'connect-pg-simple';
import session from 'express-session';
import { Adapter, Resource, Database } from '@adminjs/sql';
import cors from 'cors';
import validator, { isMobilePhoneLocales } from 'validator';


AdminJS.registerAdapter({
    Database,
    Resource,
});

const db = await new Adapter('postgresql', {
    connectionString: process.env.DATABASE_URL,
    database: 'babovkejsn'
  }).init();

const connectionString = process.env.DATABASE_URL;
const client = new Client({connectionString});
client.connect();

const authenticate = async (email: string, password: string) => {
    return await client.query("select role, password from users where email=$1", [email])
        .then((res) => {
            if (res.rowCount === 1 && res.rows[0].role === 'admin' && res.rows[0].password === password) {
                return Promise.resolve({email: email, password: password});
            }
            else {
                return null;
            }
        })
        .catch((err) => {console.log(err); return null;});
}

const ConnectSession = Connect(session);
const sessionStore = new ConnectSession({
    conObject: {
      connectionString: process.env.DATABASE_URL
    },
    tableName: 'session',
    createTableIfMissing: true,
});

const admin = new AdminJS({
    databases: [db],
});
admin.watch();

const adminRouter = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate,
      cookieName: 'adminjs',
      cookiePassword: 'sessionsecret',
    },
    null,
    {
      store: sessionStore,
      resave: true,
      saveUninitialized: true,
      secret: 'sessionsecret',
      cookie: {
        httpOnly: process.env.NODE_ENV === 'production',
        secure: process.env.NODE_ENV === 'production',
      },
      name: 'adminjs',
    }
);

const app = express();
app.use(admin.options.rootPath, adminRouter);
app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: process.env.ORIGIN,
    credentials: true
}));
app.listen(process.env.PORT);

app.get('/', (req, res) => {
    res.status(200).send("hello");
})

app.post('/api/authenticate', (req, res) => {

    // TODO: hash passwords //
    //////////////////////////

    const { email, password, rememberMe } = req.body;
    client
    .query(`select id, email, password from users where email = $1`, [email])
    .then(dbres => {
        if (dbres.rowCount === 0 || dbres.rows[0]['password'] !== password) {
            res.status(200).json({ authenticated: false, message: 'Authentication failed' });
        }
        else {
            const user = dbres.rows[0];
            delete user.password;

            const token = jwt.sign(user, process.env.SECRET as Secret, { expiresIn: rememberMe ? "30d" : "1h" });
            res
            .status(200)
            .json({ authenticated: true, message: 'Authentication successful', token: token});
        }
    })
    .catch(err => {
        console.error(err);
    })
});


// middleware verification function
const cookieJwtAuth = (req: Request, res: Response, next: NextFunction) => {
    const token = req.body.token as string;
    try {
        const verifiedToken = jwt.verify(token, process.env.SECRET as Secret);
        next();
    } 
    catch (err) {
        res.clearCookie(token);
        res.status(401).json({error: "invalid token"});
    }
};

app.post('/api/register', async (req, res) => {
    //console.log(req.body);
    const {name, lastname, email, phone, password, country, street, city, postalcode } = req.body
    if (!validator.isAlpha(name, 'sk-SK')) {
        res.status(400).send();
        //console.log("Bad name");
    }
    else if (!validator.isAlpha(lastname, 'sk-SK')) {
        res.status(400).send();
        //console.log("Bad lastname");
    }
    else if (!validator.isEmail(email)) {
        res.status(400).send();
        //console.log("Bad email");
    }
    else if (!validator.isMobilePhone(phone, 'sk-SK')) {
        res.status(400).send();
        //console.log("Bad phone");
    }
    else if (!validator.matches(password, /^[a-zA-Z0-9!@#$%^&*()_+{}[\]:;'"<>,.?\/\\~-]+$/) ||
        !validator.isStrongPassword(password)) {
            res.status(400).send();
            //console.log("Bad password");
    }
    else if (!validator.matches(country, /^Slovensko$/)) {
        res.status(400).send();
        //console.log("Bad country");
    }
    else if (!validator.isAlphanumeric(street, 'sk-SK', {ignore: " "})) {
        res.status(400).send();
        //console.log("Bad street");
    }
    else if (!validator.isAlpha(city, 'sk-SK', {ignore: " "})) {
        res.status(400).send();
        //console.log("Bad city");
    }
    else if (!validator.isPostalCode(postalcode, 'SK')) {
        res.status(400).send();
        //console.log("Bad postal");
    }
    else {
        await client 
            .query("select * from users where email = $1", [email])
            .then(async dbres => {
                if (dbres.rowCount > 0) {
                    res.status(409).send();
                    return;
                }
                await client
                    .query("insert into users (role, email, password, name, lastname, phone, country, street, city, postalcode) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
                        ['user', email, password, name, lastname, phone, country, street, city, postalcode])
                    .then(() => {
                        res.status(200).send();
                    })
            })
            .catch(err => {
                console.log(err);
                res.status(500).send();
            });
    }
});


app.get('/api/products', (req, res) => {
    client
        .query("select * from products order by id;")
        .then(dbres => {
            res.status(200).json(dbres.rows);
        })
        .catch(err => {
            console.error(err);
        })
});

async function insertDaysIntoDB(month: number) {
    const currentDate = new Date(Date.UTC(new Date().getFullYear(), month, 1));
    while (currentDate.getMonth() == month) {
        await client.query("insert into days values($1,$2,$3,$4,$5);", [currentDate.toISOString().split('T')[0], 3, 3, false, '']);
        currentDate.setDate(currentDate.getDate() + 1);
    }
};

app.get('/api/days/:month', async (req, res) => {

    const month: number = +req.params.month;
    const year = new Date().getFullYear();
    const firstDay = new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    await client
        .query("select day from days order by day desc limit 1;")
        .then(async dbres => {
            if (dbres.rowCount == 0) {
                console.log("adding days to table");
                await insertDaysIntoDB(month);
            }
            else if (dbres.rows[0].day.getMonth() < month) {
                console.log("adding days to table");
                await insertDaysIntoDB(month);
            };
        })
        .catch(err => {
            console.error(err);
        });

    await client
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
}); 

interface Token {
    id: number,
    email: string,
    iat: number,
    exp: number
};

app.post('/api/submit_order', cookieJwtAuth, async (req, res) => {

    // TODO deposit management
    const { token, order_deadline, preparation_time, price, details, note } = req.body;
    const user: Token = jwt.decode(token) as Token;
    let currentDate = new Date();
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    currentDate.setMinutes(currentDate.getMinutes() - currentDate.getTimezoneOffset());
    if (new Date().getHours() > 16) currentDate.setDate(currentDate.getDate() + 1);
    const tmp = new Date(order_deadline);
    tmp.setDate(new Date(order_deadline).getDate()-3);
    const earliestDateToStartProducing = new Date(
        Math.max(
            currentDate.getTime(),
            tmp.getTime()
        )
    )
    let days: any[] = [];
    let available_wrkld = 0;
    let leftWorkToAssign = preparation_time;
    await client
        .query("begin")
        .then(async () => {
            await client
                .query("select * from days where day > $1 and day <= $2 order by day desc", 
                    [earliestDateToStartProducing, order_deadline])
                .then(dbres => {
                    days = dbres.rows;
                    days.map(day => {available_wrkld += day.available_wrkld});
                    if (available_wrkld < preparation_time) throw error("Nedostatok casu na vyrobu");
                })
        })
        .then(async () => {
            for (let day of days) {
                const sub = Math.min(day.available_wrkld, leftWorkToAssign);
                //console.log(day.day);
                await client
                    .query("update days set available_wrkld = $1 where day = $2", 
                    [day.available_wrkld - sub, day.day.toISOString().split('T')[0]])
                    .then(() => {leftWorkToAssign -= sub;});
            }
        })
        .then(async () => {
            const d = new Date();
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            await client
                .query("insert into orders (user_id, status, order_time, order_deadline, preparation_time, price, paid, details, note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9);",
                    [user.id, "pending", d, order_deadline, preparation_time, price, 0, details, note]);

        })
        .then(async () => {
            await client 
                .query("commit;")
        })
        .catch((err) => {
            console.error('Error executing transaction:', err);
            client.query('rollback;')
              .then(() => {
                console.log('Transaction rolled back');
              })
              .catch((rollbackErr) => {
                console.error('Error rolling back transaction:', rollbackErr);
                client.end();
              })
            res.status(500).send();
          });
    res.status(200).send();
});
  

app.post('/api/orders', cookieJwtAuth, (req, res) => {
    //TODO order by active first
    const user: Token = jwt.decode(req.body.token) as Token
    client
        .query("select id, status, order_time, order_deadline, deposit_deadline, price, paid, details, note from orders where user_id = $1 order by order_deadline desc;", [user.id])
        .then(dbres => {
            res.status(200).json(dbres.rows);
        })
        .catch(err => {
            console.log(err);
            res.status(500).send();
        })
})


app.post('/api/get_user', cookieJwtAuth, (req, res) => {
    const user: Token = jwt.decode(req.body.token) as Token
    client
        .query("select name, lastname, phone, country, street, city, postalcode from users where email = $1", [user.email])
        .then(dbres => {
            res.status(200).json(dbres.rows[0]);
        })
        .catch(err => {
            console.log(err);
            res.status(500).send();
        })
})