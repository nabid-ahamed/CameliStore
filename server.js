const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// --- File Upload Setup ---
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG/PNG/WEBP/GIF images are allowed'));
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5 MB
});

const app = express();
const PORT = process.env.PORT || 35791;

// --- Middleware ---
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'camelistore_secret_key_123',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));

// --- Database setup ---
const db = new sqlite3.Database('./ecommerce.db', (err) => {
    if (err) console.error('Error opening database', err.message);
    else {
        console.log('Connected to SQLite database.');
        initDb();
    }
});

function tableHasColumn(table, col) {
    return new Promise((resolve) => {
        db.all(`PRAGMA table_info(${table})`, (err, rows) => {
            if (err || !rows) return resolve(false);
            resolve(rows.some(r => r.name === col));
        });
    });
}

async function addColumnIfMissing(table, col, def) {
    const has = await tableHasColumn(table, col);
    if (!has) {
        return new Promise((resolve) => {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`, (err) => {
                if (err) console.error(`ALTER TABLE ${table} ADD ${col}:`, err.message);
                else console.log(`Migrated: added ${table}.${col}`);
                resolve();
            });
        });
    }
}

async function initDb() {
    db.serialize(() => {
        // Users
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            password TEXT,
            role TEXT DEFAULT 'user',
            is_approved INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            phone TEXT,
            address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Products
        db.run(`CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            title TEXT,
            category TEXT,
            price REAL,
            image TEXT,
            description TEXT,
            stock INTEGER DEFAULT 10,
            featured INTEGER DEFAULT 0,
            images TEXT DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Orders
        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            total REAL,
            subtotal REAL DEFAULT 0,
            delivery_charge REAL DEFAULT 0,
            discount REAL DEFAULT 0,
            coupon_code TEXT,
            status TEXT DEFAULT 'Pending',
            items TEXT,
            shipping_address TEXT,
            phone TEXT,
            customer_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // Settings
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        // Reviews
        db.run(`CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT,
            user_id INTEGER,
            rating INTEGER,
            comment TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(product_id) REFERENCES products(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // Wishlist
        db.run(`CREATE TABLE IF NOT EXISTS wishlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            product_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, product_id)
        )`);

        // Coupons
        db.run(`CREATE TABLE IF NOT EXISTS coupons (
            code TEXT PRIMARY KEY,
            discount_type TEXT,
            discount_value REAL,
            min_purchase REAL DEFAULT 0,
            max_uses INTEGER DEFAULT 0,
            used_count INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            expires_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    });

    // --- Migrations for older DBs ---
    setTimeout(async () => {
        await addColumnIfMissing('products', 'stock', 'INTEGER DEFAULT 10');
        await addColumnIfMissing('products', 'featured', 'INTEGER DEFAULT 0');
        await addColumnIfMissing('products', 'images', "TEXT DEFAULT '[]'");
        await addColumnIfMissing('products', 'created_at', 'DATETIME');
        await addColumnIfMissing('users', 'created_at', 'DATETIME');
        await addColumnIfMissing('users', 'phone', 'TEXT');
        await addColumnIfMissing('users', 'address', 'TEXT');
        await addColumnIfMissing('users', 'email', 'TEXT');
        // Unique index for email (allows existing rows to have NULL)
        db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL");
        await addColumnIfMissing('users', 'is_approved', 'INTEGER DEFAULT 0');
        await addColumnIfMissing('users', 'is_active', 'INTEGER DEFAULT 1');
        // Ensure all current admins are approved and active
        db.run("UPDATE users SET is_approved = 1, is_active = 1 WHERE role = 'admin'");
        await addColumnIfMissing('orders', 'subtotal', 'REAL DEFAULT 0');
        await addColumnIfMissing('orders', 'discount', 'REAL DEFAULT 0');
        await addColumnIfMissing('orders', 'coupon_code', 'TEXT');
        await addColumnIfMissing('orders', 'customer_name', 'TEXT');
        await addColumnIfMissing('orders', 'delivery_charge', 'REAL DEFAULT 0');
        await addColumnIfMissing('orders', 'shipping_address', 'TEXT');
        await addColumnIfMissing('orders', 'phone', 'TEXT');

        // Seed admin
        db.get("SELECT * FROM users WHERE username = 'admin'", async (err, row) => {
            if (!row) {
                const hashedPw = await bcrypt.hash('Abc123@', 10);
                db.run("INSERT INTO users (username, password, role, is_approved, is_active) VALUES (?, ?, ?, 1, 1)", ['admin', hashedPw, 'admin']);
                console.log("Admin user seeded.");
            }
        });

        // Seed delivery setting
        db.get("SELECT * FROM settings WHERE key = 'delivery_charge'", (err, row) => {
            if (!row) db.run("INSERT INTO settings (key, value) VALUES ('delivery_charge', '60')");
        });
        db.get("SELECT * FROM settings WHERE key = 'site_name'", (err, row) => {
            if (!row) db.run("INSERT INTO settings (key, value) VALUES ('site_name', 'CameliStore')");
        });
        db.get("SELECT * FROM settings WHERE key = 'free_shipping_min'", (err, row) => {
            if (!row) db.run("INSERT INTO settings (key, value) VALUES ('free_shipping_min', '5000')");
        });

        // Seed sample coupon
        db.get("SELECT * FROM coupons WHERE code = 'WELCOME10'", (err, row) => {
            if (!row) {
                db.run("INSERT INTO coupons (code, discount_type, discount_value, min_purchase, max_uses, active) VALUES (?, ?, ?, ?, ?, ?)",
                    ['WELCOME10', 'percent', 10, 1000, 100, 1]);
            }
        });

        // Seed demo products only if empty
        db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
            if (row && row.count === 0) {
                const demoProducts = [
                    ['w1', 'Elegant Winter Coat', 'Coats', 4500, 'https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=600&q=80', 'Stay warm in style with this elegant winter coat. Premium wool blend.', 15, 1],
                    ['w2', 'Designer Leather Tote', 'Bags', 3500, 'https://images.unsplash.com/photo-1591561954557-26941169b49e?w=600&q=80', 'Spacious and elegant leather tote bag for everyday luxury.', 20, 1],
                    ['w3', 'Summer Floral Midi Dress', 'Floral Dresses', 2200, 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=600&q=80', 'Beautiful floral midi dress perfect for summer outings.', 25, 0],
                    ['w4', 'Vintage Floral Wrap Dress', 'Floral Dresses', 2500, 'https://images.unsplash.com/photo-1612336307429-8a898d10e223?w=600&q=80', 'Vintage-inspired wrap dress with timeless floral patterns.', 18, 0],
                    ['w5', 'Cat-Eye Sunglasses', 'Glasses', 850, 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=600&q=80', 'Trendy cat-eye sunglasses for the perfect retro look.', 30, 0],
                    ['w6', 'Oversized Retro Glasses', 'Glasses', 1200, 'https://images.unsplash.com/photo-1509695507497-903c140c43b0?w=600&q=80', 'Oversized retro glasses making a bold fashion statement.', 22, 0],
                    ['w7', 'Rose Gold Minimalist Watch', 'Watches', 3200, 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80', 'Minimalist rose gold watch with leather strap. Timeless elegance.', 12, 1],
                    ['w8', 'Classic Leather Strap Watch', 'Watches', 2800, 'https://images.unsplash.com/photo-1620625515032-6ed0c1790c75?w=600&q=80', 'Classic leather strap watch for a sophisticated look.', 14, 0],
                    ['w9', 'Pointed Toe Stiletto Heels', 'Women shoes', 3500, 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&q=80', 'Elegant pointed toe stiletto heels for special occasions.', 16, 0],
                    ['w10', 'Suede Ankle Boots', 'Women shoes', 4200, 'https://images.unsplash.com/photo-1534653299134-96a171b61581?w=600&q=80', 'Premium suede ankle boots with soft inner lining.', 10, 1]
                ];
                const stmt = db.prepare("INSERT INTO products (id, title, category, price, image, description, stock, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
                demoProducts.forEach(p => stmt.run(p));
                stmt.finalize();
                console.log("Demo products seeded.");
            } else {
                // For existing DB: ensure stock has a non-null value
                db.run("UPDATE products SET stock = 10 WHERE stock IS NULL");
                db.run("UPDATE products SET featured = 0 WHERE featured IS NULL");
                db.run("UPDATE products SET images = '[]' WHERE images IS NULL");
                // Replace w2 with a Designer Leather Tote (per request)
                db.run(`UPDATE products SET
                    title = 'Designer Leather Tote',
                    category = 'Bags',
                    price = 3500,
                    image = 'https://images.unsplash.com/photo-1591561954557-26941169b49e?w=600&q=80',
                    description = 'Spacious and elegant leather tote bag for everyday luxury. Crafted from premium leather, perfect for work and travel.'
                    WHERE id = 'w2'`);
                // Fix w7 image with a working Unsplash URL
                db.run(`UPDATE products SET
                    image = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80',
                    description = COALESCE(NULLIF(description, ''), 'Minimalist rose gold watch with leather strap. Timeless elegance for everyday wear.')
                    WHERE id = 'w7'`);
            }
        });
    }, 200);
}

// --- Auth Middleware ---
const requireAuth = (req, res, next) => {
    if (req.session && req.session.userId) next();
    else res.status(401).json({ error: 'Unauthorized' });
};

const requireAdmin = (req, res, next) => {
    if (req.session && req.session.userId && req.session.role === 'admin') next();
    else res.status(403).json({ error: 'Forbidden' });
};

// --- Helper: standardize errors ---
function dbErr(res, err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Database error' });
}

// =========================================================================
// AUTH ROUTES
// =========================================================================
app.post('/api/auth/signup', async (req, res) => {
    let { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Username, email and password are required.' });
    username = username.trim();
    email = email.trim().toLowerCase();
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });

    try {
        const hashedPw = await bcrypt.hash(password, 10);
        db.run("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", [username, email, hashedPw], function (err) {
            if (err) {
                const msg = /email/i.test(err.message) ? 'Email already registered.'
                    : /username/i.test(err.message) ? 'Username already exists.'
                        : 'Username or email already exists.';
                return res.status(400).json({ error: msg });
            }
            // Don't auto-login if approval is required
            res.json({ 
                message: 'Registration successful! Your account is pending admin approval. You will be able to login once approved.',
                pending_approval: true 
            });
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const id = username.trim();
    db.get("SELECT * FROM users WHERE username = ? OR email = ?", [id, id.toLowerCase()], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid credentials' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        if (!user.is_approved) {
            return res.status(403).json({ error: 'Your account is pending admin approval. Please wait for an administrator to approve your request.' });
        }

        if (!user.is_active) {
            return res.status(403).json({ error: 'Your account has been placed on hold or disabled. Please contact support for more information.' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;
        req.session.save((err) => {
            if (err) return res.status(500).json({ error: 'Session error' });
            res.json({ message: 'Login successful', user: { id: user.id, username: user.username, role: user.role } });
        });
    });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ message: 'Logged out' }));
});

app.get('/api/auth/me', (req, res) => {
    if (!req.session || !req.session.userId) return res.json({ user: null });
    db.get("SELECT id, username, email, role, phone, address FROM users WHERE id = ?", [req.session.userId], (err, user) => {
        if (err || !user) return res.json({ user: null });
        res.json({ user });
    });
});

app.put('/api/auth/profile', requireAuth, (req, res) => {
    const { phone, address, email } = req.body;
    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    db.run("UPDATE users SET phone = ?, address = ?, email = COALESCE(?, email) WHERE id = ?",
        [phone || '', address || '', cleanEmail, req.session.userId],
        function (err) {
            if (err) {
                if (/email/i.test(err.message)) return res.status(400).json({ error: 'Email already in use.' });
                return dbErr(res, err);
            }
            res.json({ message: 'Profile updated successfully' });
        });
});

app.put('/api/auth/password', requireAuth, async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
    if (new_password.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });

    db.get("SELECT password FROM users WHERE id = ?", [req.session.userId], async (err, user) => {
        if (err || !user) return res.status(500).json({ error: 'User not found' });
        const match = await bcrypt.compare(current_password, user.password);
        if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
        const hashed = await bcrypt.hash(new_password, 10);
        db.run("UPDATE users SET password = ? WHERE id = ?", [hashed, req.session.userId], (err) => {
            if (err) return dbErr(res, err);
            res.json({ message: 'Password changed successfully' });
        });
    });
});

// =========================================================================
// PRODUCTS ROUTES
// =========================================================================
app.get('/api/products', (req, res) => {
    const { category, search, sort, featured, min_price, max_price } = req.query;

    let where = [];
    let params = [];
    if (category && category !== 'all') {
        where.push('LOWER(category) = LOWER(?)');
        params.push(category);
    }
    if (search) {
        where.push('(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(category) LIKE ?)');
        const term = `%${search.toLowerCase()}%`;
        params.push(term, term, term);
    }
    if (featured === '1' || featured === 'true') {
        where.push('featured = 1');
    }
    if (min_price) {
        where.push('price >= ?');
        params.push(parseFloat(min_price));
    }
    if (max_price) {
        where.push('price <= ?');
        params.push(parseFloat(max_price));
    }

    let sql = "SELECT * FROM products";
    if (where.length) sql += " WHERE " + where.join(' AND ');

    let orderBy = ' ORDER BY rowid DESC';
    if (sort === 'price_asc') orderBy = ' ORDER BY price ASC';
    else if (sort === 'price_desc') orderBy = ' ORDER BY price DESC';
    else if (sort === 'title') orderBy = ' ORDER BY title ASC';
    else if (sort === 'newest') orderBy = ' ORDER BY rowid DESC';
    sql += orderBy;

    db.all(sql, params, (err, rows) => {
        if (err) return dbErr(res, err);
        res.json(rows);
    });
});

app.get('/api/products/categories', (req, res) => {
    db.all("SELECT category, COUNT(*) as count FROM products GROUP BY category ORDER BY category", (err, rows) => {
        if (err) return dbErr(res, err);
        res.json(rows);
    });
});

app.get('/api/products/:id', (req, res) => {
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return dbErr(res, err);
        if (!row) return res.status(404).json({ error: 'Product not found' });
        res.json(row);
    });
});

app.get('/api/products/:id/related', (req, res) => {
    db.get("SELECT category FROM products WHERE id = ?", [req.params.id], (err, row) => {
        if (err || !row) return res.json([]);
        db.all("SELECT * FROM products WHERE category = ? AND id != ? LIMIT 4", [row.category, req.params.id], (err, rows) => {
            if (err) return dbErr(res, err);
            res.json(rows);
        });
    });
});

app.post('/api/products', requireAdmin, upload.single('imageFile'), (req, res) => {
    const { id, title, category, price, description, stock, featured } = req.body;
    if (!id || !title || !category || price == null) return res.status(400).json({ error: 'id, title, category and price are required' });

    let image = req.body.image || '';
    if (req.file) image = '/uploads/' + req.file.filename;

    db.run(`INSERT INTO products (id, title, category, price, image, description, stock, featured)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title, category, parseFloat(price), image, description || '', parseInt(stock) || 0, featured ? 1 : 0],
        function (err) {
            if (err) return res.status(400).json({ error: err.message });
            res.json({ message: 'Product added successfully' });
        });
});

app.put('/api/products/:id', requireAdmin, upload.single('imageFile'), (req, res) => {
    const { title, category, price, description, stock, featured } = req.body;
    let image = req.body.image;
    if (req.file) image = '/uploads/' + req.file.filename;

    // Build dynamic SET so we don't accidentally overwrite image with undefined.
    db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, prev) => {
        if (err || !prev) return res.status(404).json({ error: 'Product not found' });
        const finalImage = (image !== undefined && image !== '') ? image : prev.image;

        db.run(`UPDATE products SET title = ?, category = ?, price = ?, image = ?, description = ?, stock = ?, featured = ? WHERE id = ?`,
            [
                title ?? prev.title,
                category ?? prev.category,
                price != null ? parseFloat(price) : prev.price,
                finalImage,
                description ?? prev.description,
                stock != null ? parseInt(stock) : prev.stock,
                featured != null ? (featured == 1 || featured === 'true' || featured === true ? 1 : 0) : prev.featured,
                req.params.id
            ],
            function (err) {
                if (err) return res.status(400).json({ error: err.message });
                res.json({ message: 'Product updated successfully' });
            });
    });
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
    db.run("DELETE FROM products WHERE id = ?", [req.params.id], function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: 'Product deleted successfully' });
    });
});

// =========================================================================
// COUPONS
// =========================================================================
app.post('/api/coupons/validate', (req, res) => {
    const { code, subtotal } = req.body;
    if (!code) return res.status(400).json({ error: 'Coupon code required' });

    db.get("SELECT * FROM coupons WHERE code = ? AND active = 1", [code.toUpperCase().trim()], (err, c) => {
        if (err) return dbErr(res, err);
        if (!c) return res.status(404).json({ error: 'Invalid coupon code' });
        if (c.expires_at && new Date(c.expires_at) < new Date()) return res.status(400).json({ error: 'Coupon has expired' });
        if (c.max_uses > 0 && c.used_count >= c.max_uses) return res.status(400).json({ error: 'Coupon usage limit reached' });
        if (subtotal < c.min_purchase) return res.status(400).json({ error: `Minimum purchase of ৳${c.min_purchase} required.` });

        let discount = 0;
        if (c.discount_type === 'percent') discount = subtotal * (c.discount_value / 100);
        else discount = c.discount_value;
        if (discount > subtotal) discount = subtotal;

        res.json({
            code: c.code,
            discount_type: c.discount_type,
            discount_value: c.discount_value,
            discount,
            message: 'Coupon applied successfully'
        });
    });
});

app.get('/api/admin/coupons', requireAdmin, (req, res) => {
    db.all("SELECT * FROM coupons ORDER BY created_at DESC", (err, rows) => {
        if (err) return dbErr(res, err);
        res.json(rows);
    });
});

app.post('/api/admin/coupons', requireAdmin, (req, res) => {
    let { code, discount_type, discount_value, min_purchase, max_uses, expires_at, active } = req.body;
    code = (code || '').toUpperCase().trim();
    if (!code) return res.status(400).json({ error: 'Code required' });
    if (!['percent', 'fixed'].includes(discount_type)) return res.status(400).json({ error: 'Invalid discount type' });

    db.run(`INSERT INTO coupons (code, discount_type, discount_value, min_purchase, max_uses, expires_at, active)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [code, discount_type, parseFloat(discount_value), parseFloat(min_purchase) || 0,
            parseInt(max_uses) || 0, expires_at || null, active ? 1 : 0],
        function (err) {
            if (err) return res.status(400).json({ error: err.message });
            res.json({ message: 'Coupon created' });
        });
});

app.put('/api/admin/coupons/:code', requireAdmin, (req, res) => {
    const { active } = req.body;
    db.run("UPDATE coupons SET active = ? WHERE code = ?", [active ? 1 : 0, req.params.code], (err) => {
        if (err) return dbErr(res, err);
        res.json({ message: 'Coupon updated' });
    });
});

app.delete('/api/admin/coupons/:code', requireAdmin, (req, res) => {
    db.run("DELETE FROM coupons WHERE code = ?", [req.params.code], (err) => {
        if (err) return dbErr(res, err);
        res.json({ message: 'Coupon deleted' });
    });
});

// =========================================================================
// ORDERS
// =========================================================================
app.post('/api/orders', (req, res) => {
    const { items, shipping_address, phone, customer_name, coupon_code } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Cart is empty' });
    if (!shipping_address || !phone) return res.status(400).json({ error: 'Address and phone required' });

    const userId = req.session.userId || null;

    // Verify items, prices, stock from DB (don't trust client price)
    const ids = items.map(i => i.id);
    const placeholders = ids.map(() => '?').join(',');
    db.all(`SELECT * FROM products WHERE id IN (${placeholders})`, ids, (err, dbProducts) => {
        if (err) return dbErr(res, err);
        if (dbProducts.length !== items.length) return res.status(400).json({ error: 'Some products are no longer available' });

        let subtotal = 0;
        const verifiedItems = [];
        for (const cartItem of items) {
            const dbProduct = dbProducts.find(p => p.id === cartItem.id);
            if (!dbProduct) return res.status(400).json({ error: 'Invalid product' });
            const qty = parseInt(cartItem.quantity) || 1;
            if (dbProduct.stock < qty) return res.status(400).json({ error: `${dbProduct.title} only has ${dbProduct.stock} in stock.` });
            subtotal += dbProduct.price * qty;
            verifiedItems.push({
                id: dbProduct.id,
                title: dbProduct.title,
                price: dbProduct.price,
                image: dbProduct.image,
                quantity: qty
            });
        }

        // Apply coupon if provided
        const finalize = (discount, finalCouponCode) => {
            // Get delivery
            db.get("SELECT value FROM settings WHERE key = 'delivery_charge'", (err, dRow) => {
                let delivery_charge = parseFloat(dRow ? dRow.value : 0) || 0;
                db.get("SELECT value FROM settings WHERE key = 'free_shipping_min'", (err, fRow) => {
                    const freeMin = parseFloat(fRow ? fRow.value : 0) || 0;
                    if (freeMin > 0 && subtotal >= freeMin) delivery_charge = 0;

                    const total = Math.max(0, subtotal - discount + delivery_charge);

                    db.run(`INSERT INTO orders (user_id, total, subtotal, delivery_charge, discount, coupon_code, items, shipping_address, phone, customer_name)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [userId, total, subtotal, delivery_charge, discount, finalCouponCode || null,
                            JSON.stringify(verifiedItems), shipping_address, phone, customer_name || null],
                        function (err) {
                            if (err) return dbErr(res, err);
                            const orderId = this.lastID;

                            // Decrement stock
                            verifiedItems.forEach(it => {
                                db.run("UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?", [it.quantity, it.id]);
                            });
                            // Increment coupon usage
                            if (finalCouponCode) {
                                db.run("UPDATE coupons SET used_count = used_count + 1 WHERE code = ?", [finalCouponCode]);
                            }

                            res.json({
                                message: 'Order placed successfully',
                                orderId,
                                total,
                                subtotal,
                                discount,
                                delivery_charge
                            });
                        });
                });
            });
        };

        if (coupon_code) {
            db.get("SELECT * FROM coupons WHERE code = ? AND active = 1", [coupon_code.toUpperCase().trim()], (err, c) => {
                if (err || !c) return finalize(0, null);
                if (c.expires_at && new Date(c.expires_at) < new Date()) return finalize(0, null);
                if (c.max_uses > 0 && c.used_count >= c.max_uses) return finalize(0, null);
                if (subtotal < c.min_purchase) return finalize(0, null);
                let discount = c.discount_type === 'percent' ? subtotal * (c.discount_value / 100) : c.discount_value;
                if (discount > subtotal) discount = subtotal;
                finalize(discount, c.code);
            });
        } else {
            finalize(0, null);
        }
    });
});

app.get('/api/orders', requireAuth, (req, res) => {
    if (req.session.role === 'admin') {
        db.all(`SELECT orders.*, COALESCE(users.username, 'Guest') as username
                FROM orders LEFT JOIN users ON orders.user_id = users.id
                ORDER BY orders.created_at DESC`, [], (err, rows) => {
            if (err) return dbErr(res, err);
            res.json(rows);
        });
    } else {
        db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC", [req.session.userId], (err, rows) => {
            if (err) return dbErr(res, err);
            res.json(rows);
        });
    }
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
    const sql = req.session.role === 'admin'
        ? `SELECT orders.*, COALESCE(users.username, 'Guest') as username
           FROM orders LEFT JOIN users ON orders.user_id = users.id WHERE orders.id = ?`
        : `SELECT * FROM orders WHERE id = ? AND user_id = ?`;
    const params = req.session.role === 'admin' ? [req.params.id] : [req.params.id, req.session.userId];

    db.get(sql, params, (err, row) => {
        if (err) return dbErr(res, err);
        if (!row) return res.status(404).json({ error: 'Order not found' });
        res.json(row);
    });
});

app.put('/api/admin/orders/:id', requireAdmin, (req, res) => {
    const { status } = req.body;
    const allowed = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    db.run("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id], function (err) {
        if (err) return dbErr(res, err);
        res.json({ message: 'Order status updated' });
    });
});

// =========================================================================
// USERS (Admin)
// =========================================================================
app.get('/api/admin/users', requireAdmin, (req, res) => {
    db.all("SELECT id, username, email, role, is_approved, is_active, phone, address, created_at FROM users ORDER BY id ASC", (err, rows) => {
        if (err) return dbErr(res, err);
        res.json(rows);
    });
});

app.put('/api/admin/users/:id/role', requireAdmin, (req, res) => {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (parseInt(req.params.id) === req.session.userId) return res.status(400).json({ error: 'You cannot demote yourself' });

    db.run("UPDATE users SET role = ? WHERE id = ?", [role, req.params.id], function (err) {
        if (err) return dbErr(res, err);
        res.json({ message: 'Role updated' });
    });
});

app.put('/api/admin/users/:id/approve', requireAdmin, (req, res) => {
    db.run("UPDATE users SET is_approved = 1 WHERE id = ?", [req.params.id], function (err) {
        if (err) return dbErr(res, err);
        res.json({ message: 'User approved successfully' });
    });
});

app.put('/api/admin/users/:id/status', requireAdmin, (req, res) => {
    const { is_active } = req.body;
    if (parseInt(req.params.id) === req.session.userId) return res.status(400).json({ error: 'You cannot disable yourself' });

    db.run("UPDATE users SET is_active = ? WHERE id = ?", [is_active ? 1 : 0, req.params.id], function (err) {
        if (err) return dbErr(res, err);
        res.json({ message: is_active ? 'User activated' : 'User placed on hold' });
    });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    if (parseInt(req.params.id) === req.session.userId) return res.status(400).json({ error: 'You cannot delete yourself' });
    db.run("DELETE FROM users WHERE id = ?", [req.params.id], function (err) {
        if (err) return dbErr(res, err);
        res.json({ message: 'User deleted' });
    });
});

// =========================================================================
// DASHBOARD STATS (Admin)
// =========================================================================
app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const stats = {};
    db.get("SELECT COUNT(*) as total_orders, COALESCE(SUM(total), 0) as total_revenue FROM orders WHERE status != 'Cancelled'",
        (err, orderStats) => {
            if (err) return dbErr(res, err);
            stats.total_orders = orderStats.total_orders || 0;
            stats.total_revenue = orderStats.total_revenue || 0;

            db.get("SELECT COUNT(*) as total_users FROM users WHERE role = 'user'", (err, u) => {
                stats.total_users = u ? u.total_users : 0;

                db.get("SELECT COUNT(*) as total_products FROM products", (err, p) => {
                    stats.total_products = p ? p.total_products : 0;

                    db.get("SELECT COUNT(*) as low_stock FROM products WHERE stock <= 5", (err, ls) => {
                        stats.low_stock = ls ? ls.low_stock : 0;

                        db.get("SELECT COUNT(*) as pending FROM orders WHERE status = 'Pending'", (err, pn) => {
                            stats.pending_orders = pn ? pn.pending : 0;

                            // Sales by status
                            db.all("SELECT status, COUNT(*) as count FROM orders GROUP BY status", (err, statusRows) => {
                                stats.orders_by_status = statusRows || [];
                                res.json(stats);
                            });
                        });
                    });
                });
            });
        });
});

app.get('/api/admin/top-products', requireAdmin, (req, res) => {
    db.all("SELECT items FROM orders WHERE status != 'Cancelled'", (err, rows) => {
        if (err) return dbErr(res, err);
        const counts = {};
        for (const row of rows) {
            try {
                const items = JSON.parse(row.items);
                for (const it of items) {
                    if (!counts[it.id]) counts[it.id] = { id: it.id, title: it.title, image: it.image, count: 0, revenue: 0 };
                    counts[it.id].count += it.quantity;
                    counts[it.id].revenue += (it.price * it.quantity);
                }
            } catch (e) { }
        }
        const list = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 5);
        res.json(list);
    });
});

app.get('/api/admin/sales-report', requireAdmin, (req, res) => {
    db.all(`SELECT DATE(created_at) as day, COUNT(*) as orders, COALESCE(SUM(total), 0) as revenue
            FROM orders WHERE status != 'Cancelled' AND created_at >= datetime('now', '-30 days')
            GROUP BY DATE(created_at) ORDER BY day ASC`, (err, rows) => {
        if (err) return dbErr(res, err);
        res.json(rows);
    });
});

app.get('/api/admin/low-stock', requireAdmin, (req, res) => {
    db.all("SELECT * FROM products WHERE stock <= 5 ORDER BY stock ASC", (err, rows) => {
        if (err) return dbErr(res, err);
        res.json(rows);
    });
});

// =========================================================================
// REVIEWS
// =========================================================================
app.get('/api/reviews/:productId', (req, res) => {
    db.all(`SELECT reviews.*, users.username FROM reviews
            JOIN users ON reviews.user_id = users.id
            WHERE product_id = ? ORDER BY created_at DESC`, [req.params.productId], (err, rows) => {
        if (err) return dbErr(res, err);
        res.json(rows);
    });
});

app.post('/api/reviews', requireAuth, (req, res) => {
    const { product_id, rating, comment } = req.body;
    const userId = req.session.userId;
    const r = parseInt(rating);
    if (!product_id || !r || r < 1 || r > 5) return res.status(400).json({ error: 'Valid rating (1-5) required' });
    if (!comment || comment.trim().length < 3) return res.status(400).json({ error: 'Please write a comment.' });

    db.all("SELECT items FROM orders WHERE user_id = ? AND status != 'Cancelled'", [userId], (err, rows) => {
        if (err) return dbErr(res, err);
        let hasPurchased = false;
        for (let row of rows) {
            try {
                const items = JSON.parse(row.items);
                if (items.some(item => item.id === product_id)) { hasPurchased = true; break; }
            } catch (e) { }
        }
        if (!hasPurchased) return res.status(403).json({ error: 'You must purchase this product to leave a review.' });

        // Prevent duplicate review per user/product
        db.get("SELECT id FROM reviews WHERE product_id = ? AND user_id = ?", [product_id, userId], (err, existing) => {
            if (existing) {
                db.run("UPDATE reviews SET rating = ?, comment = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?",
                    [r, comment.trim(), existing.id], (err) => {
                        if (err) return dbErr(res, err);
                        res.json({ message: 'Review updated successfully' });
                    });
            } else {
                db.run("INSERT INTO reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)",
                    [product_id, userId, r, comment.trim()], function (err) {
                        if (err) return res.status(400).json({ error: err.message });
                        res.json({ message: 'Review added successfully' });
                    });
            }
        });
    });
});

app.delete('/api/admin/reviews/:id', requireAdmin, (req, res) => {
    db.run("DELETE FROM reviews WHERE id = ?", [req.params.id], function (err) {
        if (err) return dbErr(res, err);
        res.json({ message: 'Review deleted' });
    });
});

// =========================================================================
// WISHLIST
// =========================================================================
app.get('/api/wishlist', requireAuth, (req, res) => {
    db.all(`SELECT products.* FROM wishlist
            JOIN products ON wishlist.product_id = products.id
            WHERE wishlist.user_id = ?
            ORDER BY wishlist.created_at DESC`, [req.session.userId], (err, rows) => {
        if (err) return dbErr(res, err);
        res.json(rows);
    });
});

app.post('/api/wishlist', requireAuth, (req, res) => {
    const { product_id } = req.body;
    if (!product_id) return res.status(400).json({ error: 'Product ID required' });
    db.run("INSERT OR IGNORE INTO wishlist (user_id, product_id) VALUES (?, ?)",
        [req.session.userId, product_id], function (err) {
            if (err) return dbErr(res, err);
            res.json({ message: 'Added to wishlist' });
        });
});

app.delete('/api/wishlist/:productId', requireAuth, (req, res) => {
    db.run("DELETE FROM wishlist WHERE user_id = ? AND product_id = ?",
        [req.session.userId, req.params.productId], function (err) {
            if (err) return dbErr(res, err);
            res.json({ message: 'Removed from wishlist' });
        });
});

// =========================================================================
// SETTINGS
// =========================================================================
app.get('/api/settings', (req, res) => {
    db.all("SELECT * FROM settings", [], (err, rows) => {
        if (err) return dbErr(res, err);
        const settingsObj = {};
        rows.forEach(r => settingsObj[r.key] = r.value);
        res.json(settingsObj);
    });
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
    const allowedKeys = ['delivery_charge', 'site_name', 'free_shipping_min'];
    const updates = [];
    for (const k of allowedKeys) {
        if (req.body[k] !== undefined) {
            updates.push(new Promise((resolve) => {
                db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    [k, String(req.body[k])], () => resolve());
            }));
        }
    }
    Promise.all(updates).then(() => res.json({ message: 'Settings updated' }));
});

// =========================================================================
// SERVE ADMIN HTML
// =========================================================================
app.get('/admin', (req, res) => {
    if (req.session.userId && req.session.role === 'admin') {
        res.sendFile(path.join(__dirname, 'views', 'admin.html'));
    } else {
        res.redirect('/login.html');
    }
});

// --- Error handler (must be last) ---
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
    }
    if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message || 'Server error' });
    }
    next();
});

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
