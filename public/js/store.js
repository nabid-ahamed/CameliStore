/**
 * store.js — Customer-facing storefront logic
 * Handles: products, cart, search/filter/sort, wishlist, coupons, checkout.
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

document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Elements ---
    const header = document.querySelector('header');
    const productGrid = document.getElementById('product-grid');

    // Scroll effect
    window.addEventListener('scroll', () => {
        if (window.scrollY > 20) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });
    const featuredGrid = document.getElementById('featured-grid');
    const featuredSection = document.getElementById('featured-section');
    const cartBtn = document.getElementById('cart-btn');
    const closeCartBtn = document.getElementById('close-cart');
    const cartSidebar = document.getElementById('cart-sidebar');
    const overlay = document.getElementById('overlay');
    const cartBadge = document.getElementById('cart-badge');
    const cartItemsContainer = document.getElementById('cart-items-container');
    const cartTotalPrice = document.getElementById('cart-total-price');
    const cartSubtotalPrice = document.getElementById('cart-subtotal-price');
    const cartDeliveryPrice = document.getElementById('cart-delivery-price');
    const checkoutBtn = document.getElementById('checkout-btn');
    const checkoutFormContainer = document.getElementById('checkout-form-container');
    const confirmOrderBtn = document.getElementById('confirm-order-btn');
    const authNav = document.getElementById('auth-nav');
    const searchInput = document.getElementById('search-input');
    const categoryFilter = document.getElementById('category-filter');
    const sortFilter = document.getElementById('sort-filter');
    const activeFiltersDiv = document.getElementById('active-filters');
    const couponInput = document.getElementById('coupon-input');
    const applyCouponBtn = document.getElementById('apply-coupon-btn');
    const couponMsg = document.getElementById('coupon-msg');

    // --- State ---
    let cart = [];
    let productsList = [];
    let currentUser = null;
    let wishlistIds = new Set();
    let deliveryCharge = 60;
    let freeShippingMin = 5000;
    let appliedCoupon = null; // {code, discount}

    // --- URL params for filters ---
    const urlParams = new URLSearchParams(window.location.search);

    // --- Initialization ---
    async function initStore() {
        const storedCart = localStorage.getItem('ecommerce_cart');
        if (storedCart) {
            try { cart = JSON.parse(storedCart); } catch (e) { cart = []; }
        }
        const storedCoupon = localStorage.getItem('ecommerce_coupon');
        if (storedCoupon) {
            try { appliedCoupon = JSON.parse(storedCoupon); } catch (e) { }
        }

        await fetchSettings();
        await checkAuth();
        if (currentUser) await fetchWishlist();
        if (productGrid) {
            await loadCategories();

            // Apply URL params to filters
            const cat = urlParams.get('category');
            if (cat && categoryFilter) categoryFilter.value = cat;
            const search = urlParams.get('search');
            if (search && searchInput) searchInput.value = search;

            await fetchProducts();
            await fetchFeatured();
        }
        updateCartUI();
    }

    async function fetchSettings() {
        try {
            const res = await fetch('/api/settings');
            const data = await res.json();
            if (data.delivery_charge) deliveryCharge = parseFloat(data.delivery_charge);
            if (data.free_shipping_min) freeShippingMin = parseFloat(data.free_shipping_min);
        } catch (err) { console.error('Failed to fetch settings', err); }
    }

    async function checkAuth() {
        try {
            const res = await fetch('/api/auth/me');
            const data = await res.json();
            currentUser = data.user;

            if (authNav) {
                if (currentUser) {
                    let navHtml = `<a href="/" class="active">Shop</a>`;
                    if (currentUser.role === 'admin') navHtml += `<a href="/admin">Admin Panel</a>`;
                    navHtml += `<a href="/profile.html">My Profile</a>`;
                    navHtml += `<a href="#" id="logout-btn">Logout</a>`;
                    authNav.innerHTML = navHtml;

                    document.getElementById('logout-btn').addEventListener('click', async (e) => {
                        e.preventDefault();
                        await fetch('/api/auth/logout', { method: 'POST' });
                        window.location.reload();
                    });
                }
            }

            if (currentUser && document.getElementById('checkout-phone')) {
                document.getElementById('checkout-phone').value = currentUser.phone || '';
                document.getElementById('checkout-address').value = currentUser.address || '';
                if (document.getElementById('checkout-name')) {
                    document.getElementById('checkout-name').value = currentUser.username || '';
                }
            }
        } catch (err) { console.error('Auth check failed', err); }
    }

    async function fetchWishlist() {
        try {
            const res = await fetch('/api/wishlist');
            if (!res.ok) return;
            const items = await res.json();
            wishlistIds = new Set(items.map(i => i.id));
        } catch (err) { console.error(err); }
    }

    async function loadCategories() {
        if (!categoryFilter) return;
        try {
            const res = await fetch('/api/products/categories');
            const cats = await res.json();
            categoryFilter.innerHTML = '<option value="all">All Categories</option>' +
                cats.map(c => `<option value="${c.category}">${c.category} (${c.count})</option>`).join('');
        } catch (err) { console.error(err); }
    }

    async function fetchProducts() {
        if (!productGrid) return;
        const params = new URLSearchParams();
        if (categoryFilter && categoryFilter.value !== 'all') params.append('category', categoryFilter.value);
        if (searchInput && searchInput.value.trim()) params.append('search', searchInput.value.trim());
        if (sortFilter && sortFilter.value) params.append('sort', sortFilter.value);

        try {
            const res = await fetch('/api/products?' + params.toString());
            productsList = await res.json();
            renderProducts(productsList);
            renderActiveFilters();
        } catch (err) {
            console.error('Failed to fetch products', err);
            productGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: red;">Error loading products.</p>`;
        }
    }

    async function fetchFeatured() {
        if (!featuredGrid) return;
        try {
            const res = await fetch('/api/products?featured=1');
            const items = await res.json();
            if (items.length === 0) {
                featuredSection.style.display = 'none';
                return;
            }
            featuredSection.style.display = 'block';
            featuredGrid.innerHTML = items.slice(0, 4).map(p => productCardHtml(p)).join('');
        } catch (err) { console.error(err); }
    }

    function renderActiveFilters() {
        if (!activeFiltersDiv) return;
        const tags = [];
        if (categoryFilter && categoryFilter.value !== 'all') {
            tags.push(`<span class="filter-tag">${categoryFilter.value} <i class="ph ph-x" data-clear="category"></i></span>`);
        }
        if (searchInput && searchInput.value.trim()) {
            tags.push(`<span class="filter-tag">Search: "${searchInput.value.trim()}" <i class="ph ph-x" data-clear="search"></i></span>`);
        }
        activeFiltersDiv.innerHTML = tags.length ? tags.join('') + ` <a href="#" id="clear-all-filters" style="font-size: 0.85rem;">Clear all</a>` : '';

        activeFiltersDiv.querySelectorAll('[data-clear]').forEach(el => {
            el.addEventListener('click', () => {
                const key = el.getAttribute('data-clear');
                if (key === 'category') categoryFilter.value = 'all';
                if (key === 'search') searchInput.value = '';
                fetchProducts();
            });
        });
        const clearAll = document.getElementById('clear-all-filters');
        if (clearAll) clearAll.addEventListener('click', (e) => {
            e.preventDefault();
            if (categoryFilter) categoryFilter.value = 'all';
            if (searchInput) searchInput.value = '';
            fetchProducts();
        });
    }

    function productCardHtml(product) {
        const inWishlist = wishlistIds.has(product.id);
        const stockBadge = product.stock <= 0
            ? '<span class="badge badge-danger">Out of Stock</span>'
            : product.stock <= 5
                ? `<span class="badge badge-warning">Only ${product.stock} left</span>`
                : '';
        const featuredBadge = product.featured ? '<span class="badge badge-featured">Featured</span>' : '';
        return `
            <div class="product-card">
                <div class="product-image-wrap" onclick="window.location.href='product.html?id=${product.id}'" style="cursor: pointer;">
                    <img src="${product.image}" alt="${product.title}" class="product-image" loading="lazy" onerror="this.src='https://placehold.co/400x500?text=No+Image'">
                    <div class="product-badges">${featuredBadge}${stockBadge}</div>
                    <button class="wishlist-btn ${inWishlist ? 'active' : ''}" onclick="event.stopPropagation(); window.toggleWishlist('${product.id}', this)" title="Wishlist">
                        <i class="ph${inWishlist ? '-fill' : ''} ph-heart"></i>
                    </button>
                </div>
                <div class="product-info">
                    <span class="product-category">${product.category}</span>
                    <h3 class="product-title" onclick="window.location.href='product.html?id=${product.id}'" style="cursor: pointer;">${product.title}</h3>
                    <div class="product-price">${formatCurrency(product.price)}</div>
                    <button class="btn btn-outline btn-full" style="margin-top: 10px;" onclick="window.addToCart('${product.id}')" ${product.stock <= 0 ? 'disabled' : ''}>
                        ${product.stock <= 0 ? 'Sold Out' : 'Add to Cart'}
                    </button>
                </div>
            </div>
        `;
    }

    function renderProducts(products) {
        if (!productGrid) return;
        if (products.length === 0) {
            productGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--color-text-muted); padding: 3rem;">No products match your search.</p>`;
            return;
        }
        productGrid.innerHTML = products.map(productCardHtml).join('');
    }

    // --- Wishlist ---
    window.toggleWishlist = async function (productId, btn) {
        if (!currentUser) {
            showToast('Please log in to use wishlist', 'error');
            setTimeout(() => window.location.href = '/login.html', 800);
            return;
        }
        const isAdding = !wishlistIds.has(productId);
        try {
            if (isAdding) {
                await fetch('/api/wishlist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ product_id: productId })
                });
                wishlistIds.add(productId);
                showToast('Added to wishlist');
            } else {
                await fetch('/api/wishlist/' + productId, { method: 'DELETE' });
                wishlistIds.delete(productId);
                showToast('Removed from wishlist');
            }
            if (btn) {
                btn.classList.toggle('active', isAdding);
                const icon = btn.querySelector('i');
                if (icon) icon.className = isAdding ? 'ph-fill ph-heart' : 'ph ph-heart';
            }
        } catch (err) { console.error(err); }
    };

    // --- Cart Logic ---
    window.addToCart = async function (productId, qty = 1) {
        if (productsList.length === 0) {
            try {
                const res = await fetch('/api/products');
                productsList = await res.json();
            } catch (err) { console.error(err); return; }
        }
        const product = productsList.find(p => p.id === productId);
        if (!product) return;
        if (product.stock <= 0) {
            showToast('Sorry, this item is out of stock', 'error');
            return;
        }
        const existingItem = cart.find(item => item.id === productId);
        if (existingItem) {
            if (existingItem.quantity + qty > product.stock) {
                showToast(`Only ${product.stock} available`, 'error');
                return;
            }
            existingItem.quantity += qty;
        } else {
            cart.push({ ...product, quantity: qty });
        }
        saveCart();
        updateCartUI();
        showToast(`${product.title} added to cart!`, 'success');
    };

    window.removeFromCart = function (productId) {
        cart = cart.filter(item => item.id !== productId);
        saveCart();
        updateCartUI();
    };

    window.updateQuantity = function (productId, delta) {
        const item = cart.find(item => item.id === productId);
        if (item) {
            const newQty = item.quantity + delta;
            if (newQty <= 0) { window.removeFromCart(productId); return; }
            const product = productsList.find(p => p.id === productId);
            if (product && newQty > product.stock) {
                showToast(`Only ${product.stock} available`, 'error');
                return;
            }
            item.quantity = newQty;
            saveCart();
            updateCartUI();
        }
    };

    function saveCart() {
        localStorage.setItem('ecommerce_cart', JSON.stringify(cart));
    }

    function getSubtotal() {
        return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    }

    function updateCartUI() {
        if (!cartBadge) return;

        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        cartBadge.textContent = totalItems;
        cartBadge.style.display = totalItems > 0 ? 'flex' : 'none';

        if (cart.length === 0) {
            cartItemsContainer.innerHTML = `
                <div class="cart-empty">
                    <i class="ph ph-shopping-bag" style="font-size: 3rem; color: #ccc;"></i>
                    <p>Your cart is empty.</p>
                </div>`;
            if (cartSubtotalPrice) cartSubtotalPrice.textContent = '৳0.00';
            if (cartDeliveryPrice) cartDeliveryPrice.textContent = '৳0.00';
            if (cartTotalPrice) cartTotalPrice.textContent = '৳0.00';
            if (checkoutBtn) checkoutBtn.style.display = 'block';
            if (checkoutFormContainer) checkoutFormContainer.style.display = 'none';
            appliedCoupon = null;
            localStorage.removeItem('ecommerce_coupon');
            if (couponMsg) couponMsg.innerHTML = '';
            return;
        }

        cartItemsContainer.innerHTML = cart.map(item => `
            <div class="cart-item">
                <img src="${item.image}" alt="${item.title}" class="cart-item-img" onerror="this.src='https://placehold.co/70x70?text=Img'">
                <div class="cart-item-info">
                    <div class="cart-item-title">${item.title}</div>
                    <div class="cart-item-price">${formatCurrency(item.price)} × ${item.quantity}</div>
                    <div style="display: flex; gap: 10px; margin-top: 5px; align-items: center;">
                        <button onclick="window.updateQuantity('${item.id}', -1)" class="qty-btn">−</button>
                        <span style="font-size: 0.9rem;">${item.quantity}</span>
                        <button onclick="window.updateQuantity('${item.id}', 1)" class="qty-btn">+</button>
                    </div>
                </div>
                <button class="cart-item-remove" onclick="window.removeFromCart('${item.id}')" title="Remove">
                    <i class="ph ph-trash"></i>
                </button>
            </div>
        `).join('');

        const subtotal = getSubtotal();
        const effectiveDelivery = (freeShippingMin > 0 && subtotal >= freeShippingMin) ? 0 : deliveryCharge;
        let discount = 0;
        if (appliedCoupon) {
            // Recompute against current subtotal
            if (appliedCoupon.discount_type === 'percent') discount = subtotal * (appliedCoupon.discount_value / 100);
            else discount = appliedCoupon.discount_value;
            if (discount > subtotal) discount = subtotal;
        }
        const total = Math.max(0, subtotal - discount + effectiveDelivery);

        if (cartSubtotalPrice) cartSubtotalPrice.textContent = formatCurrency(subtotal);
        if (cartDeliveryPrice) {
            cartDeliveryPrice.innerHTML = effectiveDelivery === 0 && deliveryCharge > 0
                ? `<span style="color: var(--color-success);">FREE</span>`
                : formatCurrency(effectiveDelivery);
        }
        if (cartTotalPrice) cartTotalPrice.textContent = formatCurrency(total);

        if (couponMsg && appliedCoupon) {
            couponMsg.innerHTML = `<span style="color: var(--color-success);">✓ Coupon "${appliedCoupon.code}" applied — Save ${formatCurrency(discount)}</span>
                <a href="#" id="remove-coupon-link" style="margin-left: 8px;">Remove</a>`;
            const rm = document.getElementById('remove-coupon-link');
            if (rm) rm.addEventListener('click', (e) => {
                e.preventDefault();
                appliedCoupon = null;
                localStorage.removeItem('ecommerce_coupon');
                updateCartUI();
            });
        }
    }

    // --- Coupon ---
    if (applyCouponBtn) {
        applyCouponBtn.addEventListener('click', async () => {
            const code = couponInput.value.trim().toUpperCase();
            if (!code) return;
            const subtotal = getSubtotal();
            try {
                const res = await fetch('/api/coupons/validate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code, subtotal })
                });
                const data = await res.json();
                if (res.ok) {
                    appliedCoupon = data;
                    localStorage.setItem('ecommerce_coupon', JSON.stringify(appliedCoupon));
                    couponInput.value = '';
                    showToast('Coupon applied!', 'success');
                    updateCartUI();
                } else {
                    couponMsg.innerHTML = `<span style="color: var(--color-danger);">${data.error}</span>`;
                }
            } catch (err) { console.error(err); }
        });
    }

    // --- Checkout ---
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', () => {
            if (cart.length === 0) { showToast('Your cart is empty'); return; }
            checkoutBtn.style.display = 'none';
            checkoutFormContainer.style.display = 'block';
        });
    }

    if (confirmOrderBtn) {
        confirmOrderBtn.addEventListener('click', async () => {
            const phone = document.getElementById('checkout-phone').value.trim();
            const address = document.getElementById('checkout-address').value.trim();
            const nameInput = document.getElementById('checkout-name');
            const customer_name = nameInput ? nameInput.value.trim() : '';

            if (!phone || !address) { showToast('Please enter phone number and address.', 'error'); return; }
            if (!/^\d{10,14}$/.test(phone.replace(/\D/g, ''))) { showToast('Please enter a valid phone number.', 'error'); return; }

            try {
                confirmOrderBtn.disabled = true;
                confirmOrderBtn.textContent = 'Processing...';

                const res = await fetch('/api/orders', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        items: cart,
                        shipping_address: address,
                        phone,
                        customer_name,
                        coupon_code: appliedCoupon ? appliedCoupon.code : null
                    })
                });
                const data = await res.json();
                if (res.ok) {
                    cart = [];
                    appliedCoupon = null;
                    localStorage.removeItem('ecommerce_coupon');
                    saveCart();
                    updateCartUI();
                    closeCart();
                    showToast(`Order #${data.orderId} placed! Total: ${formatCurrency(data.total)}`, 'success');
                    setTimeout(() => {
                        window.location.href = currentUser ? '/profile.html' : '/';
                    }, 2000);
                } else {
                    showToast(data.error || 'Failed to place order.', 'error');
                    confirmOrderBtn.disabled = false;
                    confirmOrderBtn.textContent = 'Confirm Order';
                }
            } catch (err) {
                console.error(err);
                showToast('An error occurred.', 'error');
                confirmOrderBtn.disabled = false;
                confirmOrderBtn.textContent = 'Confirm Order';
            }
        });
    }

    // --- UI ---
    function openCart() {
        if (!cartSidebar) return;
        cartSidebar.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeCart() {
        if (!cartSidebar) return;
        cartSidebar.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        if (checkoutFormContainer) checkoutFormContainer.style.display = 'none';
        if (checkoutBtn) checkoutBtn.style.display = 'block';
    }

    if (cartBtn) cartBtn.addEventListener('click', openCart);
    if (closeCartBtn) closeCartBtn.addEventListener('click', closeCart);
    if (overlay) overlay.addEventListener('click', closeCart);

    // --- Filter listeners (debounced search) ---
    let searchTimer;
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(fetchProducts, 300);
        });
    }
    if (categoryFilter) categoryFilter.addEventListener('change', fetchProducts);
    if (sortFilter) sortFilter.addEventListener('change', fetchProducts);

    // Boot up
    initStore();
});
