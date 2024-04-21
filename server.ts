import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import cors from 'cors';
dotenv.config();
import { Client } from 'pg';
import jwt, { Secret } from 'jsonwebtoken';
import { error } from 'console';


const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
}));
app.listen(8000);

const client = new Client();
client.connect();


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

            const token = jwt.sign(user, process.env.SECRET as Secret, { expiresIn: rememberMe ? "30d" : "10m" });
            res
            .status(200)
            .cookie("authtoken", token, {
                httpOnly: true,
                sameSite: false,
                secure: true,
                maxAge: rememberMe ? 1000*60*60*24*30 : 1000*60*10,
            })
            .json({ authenticated: true, role: user.role, message: 'Authentication successful' });
        }
    })
    .catch(err => {
        console.error(err);
    })
});


// middleware verification function
const cookieJwtAuth = (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies.authtoken;
    try {
        jwt.verify(token, process.env.SECRET as Secret);
        next();
    } 
    catch (err) {
        res.clearCookie(token);
        res.status(401).json({error: "invalid token"});
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
    role: string,
    mail: string,
    iat: number,
    exp: number
};

app.post('/api/submit_order', cookieJwtAuth, async (req, res) => {

    // TODO deposit management
    
    const user: Token = jwt.decode(req.cookies.authtoken) as Token;
    const { order_deadline, preparation_time, price, details, note } = req.body;
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
    console.log(earliestDateToStartProducing, order_deadline);
    await client
        .query("begin")
        .then(async () => {
            await client
                .query("select * from days where day > $1 and day <= $2 order by day desc", 
                    [earliestDateToStartProducing, order_deadline])
                .then(dbres => {
                    days = dbres.rows;
                    console.log(days);
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
  

app.get('/api/orders', cookieJwtAuth, (req, res) => {
    const user: Token = jwt.decode(req.cookies.authtoken) as Token
    client
        .query("select id, status, order_time, order_deadline, deposit_deadline, price, paid, details, note from orders where user_id = $1;", [user.id])
        .then(dbres => {
            res.status(200).json(dbres.rows);
        })
        .catch(err => {
            console.error(err);
            res.status(500).send();
        })
})