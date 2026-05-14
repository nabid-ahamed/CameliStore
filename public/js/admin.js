/**
 * admin.js — Complete admin panel logic
 * Manages: Dashboard, Products, Orders, Users, Coupons, Settings
 */

function formatCurrency(amount) {
    if (amount == null || isNaN(amount)) return '৳0.00';
    return '৳' + parseFloat(amount).toFixed(2);
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('show'); }, 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function generateId() {
    return Math.random().toString(36).substring(2, 11);
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.addEventListener('DOMContentLoaded', () => {

    let products = [];
    let orders = [];
    let coupons = [];
    let currentUserId = null;

    checkAuth();

    async function checkAuth() {
        try {
            const res = await fetch('/api/auth/me');
            const data = await res.json();
            if (!data.user || data.user.role !== 'admin') {
                window.location.href = '/login.html';
                return;
            }
            currentUserId = data.user.id;
            console.log('Logged in as user ID:', currentUserId);
        } catch (err) {
            window.location.href = '/login.html';
        }
    }

    // --- Tab Navigation ---
    const navTabs = document.querySelectorAll('.nav-tab');
    const adminSections = document.querySelectorAll('.admin-section');

    navTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            navTabs.forEach(t => t.classList.remove('active'));
            adminSections.forEach(s => s.classList.remove('active'));
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');

            if (targetId === 'dashboard-section') loadDashboard();
            if (targetId === 'products-section') fetchProducts();
            if (targetId === 'orders-section') fetchOrders();
            if (targetId === 'users-section') fetchUsers();
            if (targetId === 'coupons-section') fetchCoupons();
            if (targetId === 'settings-section') fetchSettings();
        });
    });

    // Logout
    document.getElementById('admin-logout-btn').addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login.html';
    });

    // ==================================================================
    // DASHBOARD
    // ==================================================================
    async function loadDashboard() {
        try {
            const [statsRes, topRes, salesRes, lowStockRes] = await Promise.all([
                fetch('/api/admin/stats'),
                fetch('/api/admin/top-products'),
                fetch('/api/admin/sales-report'),
                fetch('/api/admin/low-stock')
            ]);
            const stats = await statsRes.json();
            const top = await topRes.json();
            const sales = await salesRes.json();
            const lowStock = await lowStockRes.json();

            document.getElementById('stat-orders').textContent = stats.total_orders;
            document.getElementById('stat-revenue').textContent = formatCurrency(stats.total_revenue);
            document.getElementById('stat-users').textContent = stats.total_users;
            document.getElementById('stat-products').textContent = stats.total_products;
            document.getElementById('stat-pending').textContent = stats.pending_orders;
            document.getElementById('stat-lowstock').textContent = stats.low_stock;

            // Top products
            const topEl = document.getElementById('top-products');
            if (top.length === 0) {
                topEl.innerHTML = '<p style="color: var(--color-text-muted);">No sales yet.</p>';
            } else {
                topEl.innerHTML = top.map((p, i) => `
                    <div class="top-product-row">
                        <strong style="width: 24px;">${i + 1}.</strong>
                        <img src="${p.image}" alt="${escapeHtml(p.title)}" onerror="this.src='https://placehold.co/50x50?text=NA'">
                        <div style="flex: 1;">
                            <div style="font-weight: 500;">${escapeHtml(p.title)}</div>
                            <div style="font-size: 0.85rem; color: var(--color-text-muted);">${p.count} sold · ${formatCurrency(p.revenue)}</div>
                        </div>
                    </div>
                `).join('');
            }

            // Low stock
            const lowEl = document.getElementById('low-stock-list');
            if (lowStock.length === 0) {
                lowEl.innerHTML = '<p style="color: var(--color-text-muted);">All products are well stocked.</p>';
            } else {
                lowEl.innerHTML = lowStock.map(p => `
                    <div class="top-product-row">
                        <img src="${p.image}" alt="${escapeHtml(p.title)}" onerror="this.src='https://placehold.co/50x50?text=NA'">
                        <div style="flex: 1;">
                            <div style="font-weight: 500;">${escapeHtml(p.title)}</div>
                            <div style="font-size: 0.85rem; color: ${p.stock === 0 ? 'var(--color-danger)' : 'var(--color-warning)'};">
                                ${p.stock === 0 ? 'OUT OF STOCK' : `Only ${p.stock} left`}
                            </div>
                        </div>
                    </div>
                `).join('');
            }

            // Sales chart
            const salesEl = document.getElementById('sales-chart');
            if (sales.length === 0) {
                salesEl.innerHTML = '<p style="color: var(--color-text-muted);">No sales data yet.</p>';
            } else {
                const max = Math.max(...sales.map(s => s.revenue), 1);
                salesEl.innerHTML = sales.map(s => `
                    <div class="bar-row">
                        <span class="label">${new Date(s.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                        <div class="bar-wrap"><div class="bar" style="width: ${(s.revenue / max) * 100}%;"></div></div>
                        <span class="value">${formatCurrency(s.revenue)}</span>
                    </div>
                `).join('');
            }

            // Status chart
            const statusEl = document.getElementById('status-chart');
            const statusColors = { Pending: '#f39c12', Processing: '#3498db', Shipped: '#2ecc71', Delivered: '#27ae60', Cancelled: '#e74c3c' };
            const totalCount = stats.orders_by_status.reduce((s, x) => s + x.count, 0) || 1;
            if (stats.orders_by_status.length === 0) {
                statusEl.innerHTML = '<p style="color: var(--color-text-muted);">No orders yet.</p>';
            } else {
                statusEl.innerHTML = stats.orders_by_status.map(s => `
                    <div class="bar-row">
                        <span class="label">${s.status}</span>
                        <div class="bar-wrap"><div class="bar" style="width: ${(s.count / totalCount) * 100}%; background: ${statusColors[s.status] || '#000'};"></div></div>
                        <span class="value">${s.count}</span>
                    </div>
                `).join('');
            }
        } catch (err) {
            console.error(err);
            showToast('Failed to load dashboard', 'error');
        }
    }

    // ==================================================================
    // PRODUCTS
    // ==================================================================
    const productTable = document.getElementById('admin-product-list');
    const productModal = document.getElementById('product-modal');
    const productForm = document.getElementById('product-form');

    async function fetchProducts() {
        try {
            const res = await fetch('/api/products');
            products = await res.json();
            renderProducts();
            // Refresh category datalist
            const cats = [...new Set(products.map(p => p.category))];
            document.getElementById('cat-list').innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
        } catch (err) { console.error(err); }
    }

    const adminProductSearch = document.getElementById('admin-product-search');
    if (adminProductSearch) {
        adminProductSearch.addEventListener('input', renderProducts);
    }

    function renderProducts() {
        const term = (adminProductSearch ? adminProductSearch.value : '').toLowerCase();
        const filtered = term
            ? products.filter(p => p.title.toLowerCase().includes(term) || p.category.toLowerCase().includes(term) || p.id.toLowerCase().includes(term))
            : products;

        if (filtered.length === 0) {
            productTable.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 2rem;">No products.</td></tr>`;
            return;
        }
        productTable.innerHTML = filtered.map(product => {
            const stockColor = product.stock === 0 ? 'var(--color-danger)' : product.stock <= 5 ? 'var(--color-warning)' : 'var(--color-success)';
            return `
            <tr>
                <td><img src="${product.image}" alt="${escapeHtml(product.title)}" class="td-img" onerror="this.src='https://placehold.co/50x50?text=NA'"></td>
                <td>
                    <div style="font-weight: 500;">${escapeHtml(product.title)}</div>
                    <div style="font-size: 0.75rem; color: var(--color-text-muted);">ID: ${product.id}</div>
                </td>
                <td><span style="background: #eee; padding: 3px 8px; border-radius: 20px; font-size: 0.75rem;">${escapeHtml(product.category)}</span></td>
                <td style="font-weight: 600;">${formatCurrency(product.price)}</td>
                <td><span style="color: ${stockColor}; font-weight: 600;">${product.stock}</span></td>
                <td>${product.featured ? '<i class="ph-fill ph-star" style="color: gold;"></i>' : '—'}</td>
                <td>
                    <div class="action-btns">
                        <button class="btn btn-outline" style="padding: 0.4rem;" onclick="window.editProduct('${product.id}')" title="Edit"><i class="ph ph-pencil-simple"></i></button>
                        <button class="btn btn-danger" style="padding: 0.4rem;" onclick="window.deleteProduct('${product.id}')" title="Delete"><i class="ph ph-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
        }).join('');
    }

    document.getElementById('add-product-btn').addEventListener('click', () => {
        document.getElementById('modal-title').textContent = 'Add New Product';
        productForm.reset();
        document.getElementById('product-id').value = '';
        document.getElementById('product-stock').value = '10';
        document.getElementById('product-featured').checked = false;
        productModal.classList.add('active');
    });

    document.getElementById('close-modal-btn').addEventListener('click', () => productModal.classList.remove('active'));
    document.getElementById('cancel-btn').addEventListener('click', () => productModal.classList.remove('active'));

    productForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const editingId = document.getElementById('product-id').value;
        const method = editingId ? 'PUT' : 'POST';
        const url = editingId ? '/api/products/' + editingId : '/api/products';

        const formData = new FormData();
        formData.append('id', editingId || generateId());
        formData.append('title', document.getElementById('product-title').value.trim());
        formData.append('category', document.getElementById('product-category').value.trim());
        formData.append('price', parseFloat(document.getElementById('product-price').value));
        formData.append('stock', parseInt(document.getElementById('product-stock').value) || 0);
        formData.append('featured', document.getElementById('product-featured').checked ? '1' : '0');
        formData.append('image', document.getElementById('product-image').value.trim());
        formData.append('description', document.getElementById('product-desc').value.trim());

        const fileInput = document.getElementById('product-image-file');
        if (fileInput && fileInput.files.length > 0) {
            formData.append('imageFile', fileInput.files[0]);
        }

        try {
            const res = await fetch(url, { method, body: formData });
            const data = await res.json();
            if (res.ok) {
                showToast(editingId ? 'Product updated.' : 'Product created.', 'success');
                fetchProducts();
                productModal.classList.remove('active');
            } else {
                showToast(data.error || 'Failed to save product', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('Failed to save product', 'error');
        }
    });

    window.editProduct = (id) => {
        const p = products.find(x => x.id === id);
        if (!p) return;
        document.getElementById('modal-title').textContent = 'Edit Product';
        document.getElementById('product-id').value = p.id;
        document.getElementById('product-title').value = p.title;
        document.getElementById('product-category').value = p.category;
        document.getElementById('product-price').value = p.price;
        document.getElementById('product-stock').value = p.stock;
        document.getElementById('product-featured').checked = p.featured == 1;
        document.getElementById('product-image').value = p.image;
        document.getElementById('product-desc').value = p.description || '';
        const fileInput = document.getElementById('product-image-file');
        if (fileInput) fileInput.value = '';
        productModal.classList.add('active');
    };

    window.deleteProduct = async (id) => {
        if (!confirm('Delete this product? This cannot be undone.')) return;
        try {
            const res = await fetch('/api/products/' + id, { method: 'DELETE' });
            if (res.ok) { fetchProducts(); showToast('Product deleted.'); }
            else showToast('Failed to delete', 'error');
        } catch (err) { showToast('Error', 'error'); }
    };

    // ==================================================================
    // ORDERS
    // ==================================================================
    const orderTable = document.getElementById('admin-order-list');
    const orderModal = document.getElementById('order-modal');
    const orderStatusFilter = document.getElementById('order-status-filter');
    const orderSearchInput = document.getElementById('order-search');

    if (orderStatusFilter) orderStatusFilter.addEventListener('change', renderOrders);
    if (orderSearchInput) orderSearchInput.addEventListener('input', renderOrders);

    async function fetchOrders() {
        try {
            const res = await fetch('/api/orders');
            orders = await res.json();
            renderOrders();
        } catch (err) { console.error(err); }
    }

    function renderOrders() {
        let filtered = orders;
        const sf = orderStatusFilter ? orderStatusFilter.value : 'all';
        const term = (orderSearchInput ? orderSearchInput.value : '').toLowerCase();
        if (sf !== 'all') filtered = filtered.filter(o => o.status === sf);
        if (term) {
            filtered = filtered.filter(o =>
                String(o.id).includes(term) ||
                (o.username || '').toLowerCase().includes(term) ||
                (o.phone || '').toLowerCase().includes(term)
            );
        }

        if (filtered.length === 0) {
            orderTable.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 2rem;">No orders found.</td></tr>`;
            return;
        }
        orderTable.innerHTML = filtered.map(order => `
            <tr>
                <td>#${order.id}</td>
                <td>
                    <div style="font-weight: 500;">${escapeHtml(order.username || 'Guest')}</div>
                    <div style="font-size: 0.8rem; color: var(--color-text-muted);">${escapeHtml(order.phone || '')}</div>
                </td>
                <td style="font-weight: 600;">${formatCurrency(order.total)}</td>
                <td>
                    <select class="form-control" style="padding: 5px 8px; width: auto; font-size: 0.85rem;" onchange="window.updateOrderStatus(${order.id}, this.value)">
                        <option value="Pending" ${order.status === 'Pending' ? 'selected' : ''}>Pending</option>
                        <option value="Processing" ${order.status === 'Processing' ? 'selected' : ''}>Processing</option>
                        <option value="Shipped" ${order.status === 'Shipped' ? 'selected' : ''}>Shipped</option>
                        <option value="Delivered" ${order.status === 'Delivered' ? 'selected' : ''}>Delivered</option>
                        <option value="Cancelled" ${order.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
                    </select>
                </td>
                <td style="font-size: 0.85rem;">${new Date(order.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-outline" style="padding: 0.4rem 0.8rem;" onclick="window.viewOrder(${order.id})">Details</button>
                </td>
            </tr>
        `).join('');
    }

    window.updateOrderStatus = async (id, status) => {
        try {
            const res = await fetch('/api/admin/orders/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            if (res.ok) {
                showToast('Order #' + id + ' → ' + status, 'success');
                const o = orders.find(x => x.id === id);
                if (o) o.status = status;
            }
        } catch (err) { console.error(err); }
    };

    window.viewOrder = (id) => {
        const order = orders.find(o => o.id === id);
        if (!order) return;
        const items = JSON.parse(order.items || '[]');
        document.getElementById('order-modal-content').innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                <div><strong>Order ID:</strong> #${order.id}</div>
                <div><strong>Status:</strong> <span class="status-badge ${order.status.toLowerCase()}">${order.status}</span></div>
                <div><strong>Customer:</strong> ${escapeHtml(order.username || 'Guest')}</div>
                <div><strong>Phone:</strong> ${escapeHtml(order.phone || '')}</div>
                <div style="grid-column: 1/-1;"><strong>Address:</strong><br>${escapeHtml(order.shipping_address || '')}</div>
                <div style="grid-column: 1/-1;"><strong>Date:</strong> ${new Date(order.created_at).toLocaleString()}</div>
            </div>
            <hr>
            <h4 style="margin: 1rem 0;">Items</h4>
            <table style="width: 100%; font-size: 0.9rem;">
                ${items.map(i => `
                    <tr>
                        <td><img src="${i.image}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px;" onerror="this.src='https://placehold.co/40x40'"></td>
                        <td>${escapeHtml(i.title)}</td>
                        <td>${i.quantity} × ${formatCurrency(i.price)}</td>
                        <td style="text-align: right; font-weight: 600;">${formatCurrency(i.price * i.quantity)}</td>
                    </tr>
                `).join('')}
            </table>
            <hr style="margin: 1rem 0;">
            <div style="text-align: right; font-size: 0.95rem;">
                <div>Subtotal: ${formatCurrency(order.subtotal || 0)}</div>
                ${order.discount > 0 ? `<div style="color: var(--color-success);">Discount${order.coupon_code ? ` (${order.coupon_code})` : ''}: −${formatCurrency(order.discount)}</div>` : ''}
                <div>Delivery: ${formatCurrency(order.delivery_charge)}</div>
                <div style="font-size: 1.2rem; font-weight: 700; margin-top: 0.5rem;">Total: ${formatCurrency(order.total)}</div>
            </div>
        `;
        orderModal.classList.add('active');
    };

    document.getElementById('close-order-modal-btn').addEventListener('click', () => orderModal.classList.remove('active'));

    // ==================================================================
    // USERS
    // ==================================================================
    const userTable = document.getElementById('admin-user-list');

    async function fetchUsers() {
        try {
            const res = await fetch('/api/admin/users');
            const users = await res.json();
            if (users.length === 0) {
                userTable.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 2rem;">No users.</td></tr>`;
                return;
            }
            userTable.innerHTML = users.map(user => {
                const isSelf = user.id === currentUserId;
                const isAdmin = user.role === 'admin';
                const emailHtml = user.email
                    ? `<a href="mailto:${escapeHtml(user.email)}" style="color: var(--color-text); text-decoration: underline;">${escapeHtml(user.email)}</a>`
                    : '<span style="color: var(--color-text-muted); font-size: 0.85rem;">—</span>';

                const approvalHtml = user.is_approved 
                    ? '<span class="status-badge shipped">Approved</span>' 
                    : '<span class="status-badge pending">Pending</span>';
                
                const accountHtml = user.is_active
                    ? '<span class="status-badge shipped">Active</span>'
                    : '<span class="status-badge cancelled">Hold</span>';

                return `
                <tr>
                    <td>${user.id}</td>
                    <td style="font-weight: 500;">${escapeHtml(user.username)} ${isSelf ? '<span style="color:var(--color-text-muted);font-size:0.8rem;">(you)</span>' : ''}</td>
                    <td>${emailHtml}</td>
                    <td>
                        <select class="form-control" style="padding: 4px 8px; width: auto; font-size: 0.85rem;" onchange="window.changeRole(${user.id}, this.value)" ${isSelf ? 'disabled' : ''}>
                            <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
                            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                        </select>
                    </td>
                    <td>${approvalHtml}</td>
                    <td>${accountHtml}</td>
                    <td style="font-size: 0.85rem;">${user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}</td>
                    <td>
                        <div class="action-btns">
                            ${!user.is_approved ? `<button class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;" onclick="window.approveUser(${user.id})">Approve</button>` : ''}
                            ${(!isAdmin && user.is_approved) ? `
                                <button class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;" onclick="window.toggleStatus(${user.id}, ${user.is_active ? 0 : 1})">
                                    ${user.is_active ? 'Hold' : 'Activate'}
                                </button>
                            ` : (isAdmin ? '—' : '')}
                            ${isAdmin ? '' : `<button class="btn btn-danger" style="padding: 0.4rem;" onclick="window.deleteUser(${user.id})" title="Delete"><i class="ph ph-trash"></i></button>`}
                        </div>
                    </td>
                </tr>
            `;
            }).join('');
        } catch (err) { console.error(err); }
    }

    window.changeRole = async (id, role) => {
        try {
            const res = await fetch('/api/admin/users/' + id + '/role', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role })
            });
            const data = await res.json();
            if (res.ok) showToast('Role updated', 'success');
            else { showToast(data.error || 'Failed', 'error'); fetchUsers(); }
        } catch (err) { showToast('Error', 'error'); }
    };

    window.approveUser = async (id) => {
        console.log('Approving user:', id);
        try {
            const res = await fetch('/api/admin/users/' + id + '/approve', { method: 'PUT' });
            if (res.ok) {
                showToast('User approved', 'success');
                fetchUsers();
            } else {
                const data = await res.json();
                showToast(data.error || 'Failed to approve', 'error');
            }
        } catch (err) { console.error('Approve error:', err); }
    };

    window.toggleStatus = async (id, isActive) => {
        console.log('Toggling status for user:', id, 'to active:', isActive);
        try {
            const res = await fetch('/api/admin/users/' + id + '/status', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: isActive })
            });
            if (res.ok) {
                showToast(isActive ? 'User activated' : 'User placed on hold', 'success');
                fetchUsers();
            } else {
                const data = await res.json();
                showToast(data.error || 'Failed to update status', 'error');
            }
        } catch (err) { console.error('Toggle status error:', err); }
    };

    window.deleteUser = async (id) => {
        if (!confirm('Delete this user? This cannot be undone.')) return;
        try {
            const res = await fetch('/api/admin/users/' + id, { method: 'DELETE' });
            if (res.ok) { showToast('User deleted'); fetchUsers(); }
            else showToast('Failed to delete', 'error');
        } catch (err) { }
    };

    // ==================================================================
    // COUPONS
    // ==================================================================
    const couponTable = document.getElementById('admin-coupon-list');
    const couponModal = document.getElementById('coupon-modal');
    const couponForm = document.getElementById('coupon-form');

    async function fetchCoupons() {
        try {
            const res = await fetch('/api/admin/coupons');
            coupons = await res.json();
            renderCoupons();
        } catch (err) { console.error(err); }
    }

    function renderCoupons() {
        if (coupons.length === 0) {
            couponTable.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 2rem;">No coupons.</td></tr>`;
            return;
        }
        couponTable.innerHTML = coupons.map(c => `
            <tr>
                <td><strong>${escapeHtml(c.code)}</strong></td>
                <td>${c.discount_type === 'percent' ? `${c.discount_value}%` : formatCurrency(c.discount_value)}</td>
                <td>${formatCurrency(c.min_purchase)}</td>
                <td>${c.used_count} / ${c.max_uses === 0 ? '∞' : c.max_uses}</td>
                <td>
                    <span class="status-badge ${c.active ? 'shipped' : 'cancelled'}">${c.active ? 'Active' : 'Inactive'}</span>
                </td>
                <td>
                    <div class="action-btns">
                        <button class="btn btn-outline" style="padding: 0.4rem 0.7rem;" onclick="window.toggleCoupon('${c.code}', ${c.active ? 0 : 1})">
                            ${c.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button class="btn btn-danger" style="padding: 0.4rem;" onclick="window.deleteCoupon('${c.code}')"><i class="ph ph-trash"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    document.getElementById('add-coupon-btn').addEventListener('click', () => {
        couponForm.reset();
        document.getElementById('coupon-active').checked = true;
        couponModal.classList.add('active');
    });
    document.getElementById('close-coupon-modal-btn').addEventListener('click', () => couponModal.classList.remove('active'));
    document.getElementById('coupon-cancel-btn').addEventListener('click', () => couponModal.classList.remove('active'));

    couponForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            code: document.getElementById('coupon-code').value.trim(),
            discount_type: document.getElementById('coupon-type').value,
            discount_value: parseFloat(document.getElementById('coupon-value').value),
            min_purchase: parseFloat(document.getElementById('coupon-min').value) || 0,
            max_uses: parseInt(document.getElementById('coupon-max').value) || 0,
            expires_at: document.getElementById('coupon-expires').value || null,
            active: document.getElementById('coupon-active').checked
        };
        try {
            const res = await fetch('/api/admin/coupons', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const r = await res.json();
            if (res.ok) {
                showToast('Coupon created', 'success');
                couponModal.classList.remove('active');
                fetchCoupons();
            } else showToast(r.error || 'Failed', 'error');
        } catch (err) { showToast('Error', 'error'); }
    });

    window.toggleCoupon = async (code, active) => {
        try {
            await fetch('/api/admin/coupons/' + code, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active })
            });
            showToast('Coupon updated', 'success');
            fetchCoupons();
        } catch (err) { }
    };

    window.deleteCoupon = async (code) => {
        if (!confirm('Delete coupon ' + code + '?')) return;
        try {
            await fetch('/api/admin/coupons/' + code, { method: 'DELETE' });
            showToast('Coupon deleted');
            fetchCoupons();
        } catch (err) { }
    };

    // ==================================================================
    // SETTINGS
    // ==================================================================
    async function fetchSettings() {
        try {
            const res = await fetch('/api/settings');
            const settings = await res.json();
            document.getElementById('setting-site-name').value = settings.site_name || 'CameliStore';
            document.getElementById('setting-delivery').value = settings.delivery_charge || 0;
            document.getElementById('setting-free-shipping').value = settings.free_shipping_min || 0;
        } catch (err) { console.error(err); }
    }

    document.getElementById('settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
            site_name: document.getElementById('setting-site-name').value,
            delivery_charge: document.getElementById('setting-delivery').value,
            free_shipping_min: document.getElementById('setting-free-shipping').value
        };
        try {
            const res = await fetch('/api/admin/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) showToast('Settings saved', 'success');
            else showToast('Failed to save', 'error');
        } catch (err) { showToast('Error', 'error'); }
    });

    // Initial dashboard load
    loadDashboard();
});
