const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./ecommerce.db');

db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err) {
            console.error(err);
            return;
        }
        tables.forEach(table => {
            const tableName = table.name;
            db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
                if (err) return;
                columns.forEach(column => {
                    const colName = column.name;
                    db.all(`SELECT * FROM ${tableName} WHERE ${colName} LIKE '%nabidahamed%'`, (err, rows) => {
                        if (err) return;
                        if (rows.length > 0) {
                            console.log(`Found in table ${tableName}, column ${colName}:`, rows);
                        }
                    });
                });
            });
        });
    });
});
