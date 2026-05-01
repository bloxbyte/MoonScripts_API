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

async function validateKey(key) {
  const result = await pool.query(
    "SELECT * FROM Accounts WHERE Key = $1",
    [key]
  );

  if (result.rows.length === 0) {
    return { error: "Invalid key" };
  }

  const account = result.rows[0];

  const now = new Date();
  if (account.keyexpiry && new Date(account.keyexpiry) < now) {
    await pool.query(
      "UPDATE Accounts SET Key = NULL, KeyExpiry = NULL WHERE Username = $1",
      [account.username]
    );

    return { error: "Key expired" };
  }

  return { account };
}

app.post("/api/boosting", async (req, res) => {
  const key = req.query.key;
  const { Topic } = req.body;

  if (!key) {
    return res.status(400).json({ error: "Missing key" });
  }

  try {
    const { account, error } = await validateKey(key);

    if (error) {
      return res.status(403).json({ error });
    }

    if (Topic === "Get") {
      const { Data, Username, MainAccount } = req.body;

      if (Data === "Rounds") {
        if (!Username) {
          return res.status(400).json({ error: "Missing Username" });
        }

        const boosting = await pool.query(
          "SELECT RoundCount FROM Boosting_Data WHERE MainAccount = $1",
          [MainAccount]
        );

        if (boosting.rows.length === 0) {
          return res.status(404).json({ error: "Account not found" });
        }

        return res.json({
          success: true,
          RoundCount: boosting.rows[0].roundcount
        });
      }

      if (Data === "Players") {
       if (!MainAccount) {
          return res.status(400).json({ error: "Missing MainAccount" });
        }
      
        const tableName = "alts_" + MainAccount.replace(/[^a-zA-Z0-9_]/g, "");
      
        const result = await pool.query(
          `SELECT Username, Target FROM ${tableName}`
        ); 
      
        const rows = result.rows;
      
        const output = [];
      
        const allPlayers = [MainAccount, ...rows.map(r => r.username)];
      
        for (let i = 0; i < allPlayers.length; i++) {
          const player = allPlayers[i];
      
          let target = null;
          let assassin = null;
      
          if (player === MainAccount) {
            const found = rows.find(r => r.target === MainAccount);
            if (found) assassin = found.username;
          } else {
            const row = rows.find(r => r.username === player);
            if (row) target = row.target;
      
            const found = rows.find(r => r.target === player);
            if (found) assassin = found.username;
          }
      
          output.push({
            Player: player,
            Target: target,
            Assassin: assassin
          });
        }
      
        return res.json({
          success: true,
          Players: output
        });
      }  

      return res.status(400).json({ error: "Invalid Data type" });
    }

    if (Topic === "Update") {
      const { AccountType, MainAccount, Username, Object, Value } = req.body;

      if (AccountType === "Alt" && Object === "Target") {
        if (!Username || !MainAccount || !Value) {
          return res.status(400).json({ error: "Missing data" });
        }
      
        const tableName = "alts_" + MainAccount.replace(/[^a-zA-Z0-9_]/g, "");
      
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ${tableName} (
            Username TEXT PRIMARY KEY,
            Target TEXT
          )
        `);
      
        await pool.query(
          `INSERT INTO ${tableName} (Username, Target)
           VALUES ($1, $2)
           ON CONFLICT (Username)
           DO UPDATE SET Target = $2`,
          [Username, Value]
        );
      
        return res.json({ success: true });
      }
    
      if (AccountType === "Main" && Object === "Rounds") {
        if (!Username) {
          return res.status(400).json({ error: "Missing Username" });
        }
    
        const result = await pool.query(
          "UPDATE Boosting_Data SET RoundCount = $2 WHERE MainAccount = $1 RETURNING RoundCount",
          [Username, Value]
        );
    
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Account not found" });
        }
    
        return res.json({
          success: true,
          RoundCount: result.rows[0].roundcount
        });
      }
    
      return res.status(400).json({ error: "Invalid update request" });
    }

    if (Topic === "Register") {
      const { AccountType, Username, MainAccount, AltsList } = req.body;

      if (AccountType === "Alt") {
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

      if (AccountType === "Main") {
        if (!Username || !AltsList) {
          return res.status(400).json({ error: "Missing data" });
        }

        const alts = AltsList.map(name => ({
          username: name,
          verified: false
        }));

        await pool.query(
          `INSERT INTO Boosting_Data (MainAccount, Alts, RoundCount)
           VALUES ($1, $2, 0)
           ON CONFLICT (MainAccount)
           DO UPDATE SET Alts = $2, RoundCount = 0`,
          [Username, JSON.stringify(alts)]
        );

        return res.json({ success: true, type: "main registered" });
      }

      return res.status(400).json({ error: "Invalid account type" });
    }

    if (Topic === "ClearData") {
      const { MainAccount } = req.body;
    
      if (!MainAccount) {
        return res.status(400).json({ error: "Missing MainAccount" });
      }
    
      const tableName = "alts_" + MainAccount.replace(/[^a-zA-Z0-9_]/g, "");
    
      await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    
      return res.json({ success: true });
    }

    return res.status(400).json({ error: "Invalid topic" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(3000);
