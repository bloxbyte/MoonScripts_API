const express = require("express");
const { Pool } = require("pg");

const app = express();

app.use(express.json());


const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_9D7UXSpgrlVv@ep-snowy-forest-abqti85c-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: {
    rejectUnauthorized: false
  }
});

app.all("/boosting", async (req, res) => {
  if (req.method === "GET") {
    return res.status(200).end();
  }

  if (req.method === "POST") {
    const key = req.query.key;
    const { accountType, Username, MainAccount, altList } = req.body;

    if (!key) {
      return res.status(400).json({ error: "Missing key" });
    }

    try {
      const result = await pool.query(
        "SELECT * FROM Accounts WHERE Key = $1",
        [key]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({ error: "Invalid key" });
      }

      const account = result.rows[0];

      const now = new Date();
      if (account.keyexpiry && new Date(account.keyexpiry) < now) {
        await pool.query(
          "UPDATE Accounts SET Key = NULL, KeyExpiry = NULL WHERE Username = $1",
          [account.username]
        );

        return res.status(403).json({ error: "Key expired" });
      }

      if (accountType === "alt") {
        if (!MainAccount || !Username) {
          return res.status(400).json({ error: "Missing data" });
        }

        const boosting = await pool.query(
          "SELECT * FROM Boosting_Data WHERE MainAccount = $1",
          [MainAccount]
        );

        if (boosting.rows.length === 0) {
          return res.status(404).json({ error: "Main account not found" });
        }

        let alts = boosting.rows[0].alts;

        alts = alts.map(alt => {
          if (alt.username === Username) {
            return { ...alt, verified: true };
          }
          return alt;
        });

        await pool.query(
          "UPDATE Boosting_Data SET Alts = $1 WHERE MainAccount = $2",
          [JSON.stringify(alts), MainAccount]
        );

        return res.json({ success: true, type: "alt verified" });
      }

      if (accountType === "main") {
        if (!Username || !altList) {
          return res.status(400).json({ error: "Missing data" });
        }

        const alts = altList.map(name => ({
          username: name,
          verified: false
        }));

        await pool.query(
          `INSERT INTO Boosting_Data (MainAccount, Alts)
           VALUES ($1, $2)
           ON CONFLICT (MainAccount)
           DO UPDATE SET Alts = $2`,
          [Username, JSON.stringify(alts)]
        );

        return res.json({ success: true, type: "main registered" });
      }

      return res.status(400).json({ error: "Invalid account type" });

    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  }

  return res.status(405).end();
});

app.listen(3000);