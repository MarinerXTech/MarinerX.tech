// Microsoft Clarity Tracking
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "re4qg49ycv");

// Shopping Cart System with PayPal Checkout (server-backed)
class ShoppingCart {
  constructor() {
    this.items = [];
    this.isRenderingPayPal = false;
    // LIVE Client ID (provided by user)
    this.PAYPAL_CLIENT_ID = 'AZGML5-V-ZPAiZjVaFOkdDAoOLub69d8C6ZethbT4Ek9CCFkocJb6vFPD4uhg01vdBDQ-YBNrEeywjVW';
    // Cloudflare Worker endpoint (server-side order creation/capture)
    this.SERVER_ENDPOINT = 'https://marinerx-payments.marinerxtech.workers.dev';
    this.init();
  }

  init() {
    this.loadCart();
    this.createCartUI();
    this.bindEvents();
    this.updateCartCount();
    this.updateCartDisplay();
  }

  createCartUI() {
    // Avoid duplicate UI
    if (!document.querySelector('.cart-icon')) {
      const cartIcon = document.createElement('div');
      cartIcon.className = 'cart-icon';
      cartIcon.setAttribute('aria-label', 'Open cart');
      cartIcon.innerHTML = `
        <span style="font-size:20px">🛒</span>
        <span class="cart-count">0</span>
      `;
      document.body.appendChild(cartIcon);
    }

    if (!document.querySelector('.cart-panel')) {
      const cartPanel = document.createElement('div');
      cartPanel.className = 'cart-panel';
      cartPanel.innerHTML = `
        <div class="cart-header">
          <h3>Shopping Cart</h3>
          <button class="close-cart" aria-label="Close cart">&times;</button>
        </div>
        <div class="cart-items"></div>
        <div class="cart-footer">
          <div class="cart-total">
            <span>Total:</span>
            <span class="total-amount">$0.00</span>
          </div>
          <div class="paypal-separator">Checkout</div>
          <div id="paypal-buttons" class="paypal-buttons-wrapper"></div>
          <button class="checkout-btn" style="display:none">Checkout</button>
        </div>
      `;
      document.body.appendChild(cartPanel);
    }

    // Ensure PayPal SDK is present, then render buttons
    this.ensurePayPalSdkLoaded().then(() => this.renderPayPalButtonsIfAvailable());
  }

  ensurePayPalSdkLoaded() {
    return new Promise((resolve) => {
      const sdkLoaded = () => resolve();

      if (window.paypal && (paypal.Buttons || paypal.HostedButtons)) {
        resolve();
        return;
      }

      const existing = document.querySelector('script[src*="paypal.com/sdk/js"]');
      if (existing) {
        existing.addEventListener('load', sdkLoaded);
        return;
      }

      const script = document.createElement('script');
      const params = new URLSearchParams({
        'client-id': this.PAYPAL_CLIENT_ID,
        components: 'buttons',
        currency: 'USD',
        intent: 'capture'
      });
      script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
      script.async = true;
      script.onload = sdkLoaded;
      document.head.appendChild(script);
    });
  }

  renderPayPalButtonsIfAvailable() {
    if (this.isRenderingPayPal) return; // Prevent multiple renders
    this.isRenderingPayPal = true;

    if (window.paypal && document.getElementById('paypal-buttons')) {
      try {
        if (!paypal.Buttons) {
          this.isRenderingPayPal = false;
          return;
        }

        // Clear existing buttons
        const container = document.getElementById('paypal-buttons');
        container.innerHTML = '';

        paypal.Buttons({
          style: { layout: 'vertical', color: 'blue', shape: 'pill', label: 'checkout', tagline: false, height: 45 },
          funding: { disallowed: [ paypal.FUNDING.VENMO, paypal.FUNDING.PAYLATER ] },
          createOrder: () => {
            if (!this.SERVER_ENDPOINT) {
              alert('Checkout is not configured yet. Please set the server endpoint.');
              throw new Error('Server endpoint not configured');
            }

            // Track begin_checkout
            if (typeof gtag !== 'undefined') {
              const totalValue = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
              gtag('event', 'begin_checkout', {
                currency: 'USD',
                value: totalValue,
                items: this.items.map(item => ({
                  item_id: item.id,
                  item_name: item.name,
                  item_variant: item.variant,
                  price: item.price,
                  quantity: item.quantity
                }))
              });
            }

            const payload = {
              items: this.items.map(({ id, name, variant, price, quantity, image }) => ({
                id,
                name,
                variant,
                price,
                quantity,
                image
              }))
            };
            return fetch(this.SERVER_ENDPOINT + '/create-order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
            .then(res => {
              if (!res.ok) throw new Error('create-order failed: ' + res.status);
              return res.json();
            })
            .then(data => {
              if (!data || !data.orderID) throw new Error('Invalid create-order response');
              return data.orderID;
            });
          },
          onShippingChange: (data, actions) => {
            return fetch(this.SERVER_ENDPOINT + '/update-order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderID: data.orderID,
                items: this.items.map(({ id, name, variant, price, quantity, image }) => ({
                  id,
                  name,
                  variant,
                  price,
                  quantity,
                  image
                })),
                shipTo: data.shipping_address
              })
            })
            .then(res => {
              if (!res.ok) return actions.reject();
              return res.json();
            })
            .then(result => {
              if (result && result.ok) return actions.resolve();
              return actions.reject();
            })
            .catch(() => actions.reject());
          },
          onApprove: (data) => {
            // Show loading state
            const paypalButtons = document.getElementById('paypal-buttons');
            if (paypalButtons) {
              paypalButtons.innerHTML = '<div style="text-align: center; padding: 20px;">Processing your order...</div>';
            }

            return fetch(this.SERVER_ENDPOINT + '/capture-order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderID: data.orderID })
            })
            .then(res => {
              if (!res.ok) {
                throw new Error(`Server error: ${res.status}`);
              }
              return res.json();
            })
            .then(result => {
              if (result && result.status === 'COMPLETED') {
                this.clearCart();
                this.closeCart();
                if (typeof gtag !== 'undefined') {
                  const totalValue = Number(result.amount || 0);
                  gtag('event', 'purchase', {
                    currency: 'USD',
                    value: totalValue,
                    transaction_id: data.orderID,
                    items: result.items || []
                  });
                }
                window.location.href = 'thank-you.html';
              } else {
                throw new Error(result?.error || 'Payment capture failed');
              }
            })
            .catch(error => {
              console.error('Payment capture error:', error);
              alert('There was an error processing your payment. Please contact support if the issue persists.');
              // Re-render PayPal buttons on error
              this.renderPayPalButtonsIfAvailable();
              throw error;
            });
          },
          onCancel: () => {
            // no-op
          },
          onError: (err) => {
            console.error('PayPal error', err);
            alert('There was an error with PayPal. Please try again.');
          }
        }).render('#paypal-buttons').then(() => {
          this.isRenderingPayPal = false;
        }).catch((err) => {
          console.error('PayPal render error:', err);
          this.isRenderingPayPal = false;
        });
      } catch (e) {
        console.warn('PayPal Buttons not available:', e);
        this.isRenderingPayPal = false;
      }
    } else {
      this.isRenderingPayPal = false;
    }
  }

  bindEvents() {
    // Toggle cart
    document.querySelector('.cart-icon').addEventListener('click', () => {
      this.toggleCart();
    });

    document.querySelector('.close-cart').addEventListener('click', () => {
      this.toggleCart();
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.cart-icon') && !e.target.closest('.cart-panel')) {
        this.closeCart();
      }
    });

    // Data-driven add-to-cart buttons
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-add-to-cart]');
      if (!btn) return;
      e.preventDefault();
      const id = btn.dataset.id;
      try {
        const catalog = (window.PRODUCT_CATALOG || {});
        const fromCatalog = catalog[id];
        if (!fromCatalog) throw new Error('Missing catalog entry for ' + id);
        const product = {
          id,
          name: fromCatalog.name,
          variant: btn.dataset.variant || 'standard',
          price: Number(fromCatalog.price),
          quantity: Number(btn.dataset.qty || 1),
          image: (fromCatalog.image && fromCatalog.image.src) || ''
        };
        if (!product.name || !(product.price > 0)) throw new Error('Catalog entry incomplete for ' + id);
        this.addItem(product);
      } catch (err) {
        console.warn('Add-to-cart error:', err);
        alert('This item is being updated. Please try again later.');
      }
    });
  }

  toggleCart() {
    const cartPanel = document.querySelector('.cart-panel');
    cartPanel.classList.toggle('open');
    if (cartPanel.classList.contains('open')) {
      this.loadCart();
      this.updateCartDisplay();
      this.updateCartCount();
      // Track view_cart
      if (typeof gtag !== 'undefined' && this.items.length > 0) {
        const totalValue = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        gtag('event', 'view_cart', {
          currency: 'USD',
          value: totalValue,
          items: this.items.map(item => ({
            item_id: item.id,
            item_name: item.name,
            item_variant: item.variant,
            price: item.price,
            quantity: item.quantity
          }))
        });
      }
    }
  }

  closeCart() {
    const panel = document.querySelector('.cart-panel');
    if (panel) panel.classList.remove('open');
  }

  addItem(product) {
    const existingItem = this.items.find(item => item.id === product.id && item.variant === product.variant);
    if (existingItem) {
      existingItem.quantity += product.quantity;
    } else {
      this.items.push({ ...product });
    }

    this.saveCart();
    this.updateCartDisplay();
    this.updateCartCount();
    this.showAddedMessage(product);

    // Track add_to_cart
    if (typeof gtag !== 'undefined') {
      gtag('event', 'add_to_cart', {
        currency: 'USD',
        value: product.price * product.quantity,
        items: [{
          item_id: product.id,
          item_name: product.name,
          item_variant: product.variant,
          price: product.price,
          quantity: product.quantity
        }]
      });
    }

    this.ensureCartStaysOpen();
  }

  removeItem(index) {
    const removedItem = this.items[index];
    this.items.splice(index, 1);
    this.saveCart();
    this.updateCartDisplay();
    this.updateCartCount();

    // Track remove_from_cart
    if (removedItem && typeof gtag !== 'undefined') {
      gtag('event', 'remove_from_cart', {
        currency: 'USD',
        value: removedItem.price * removedItem.quantity,
        items: [{
          item_id: removedItem.id,
          item_name: removedItem.name,
          item_variant: removedItem.variant,
          price: removedItem.price,
          quantity: removedItem.quantity
        }]
      });
    }

    this.ensureCartStaysOpen();
  }

  updateQuantity(index, newQuantity) {
    if (newQuantity <= 0) {
      this.removeItem(index);
    } else {
      this.items[index].quantity = newQuantity;
      this.saveCart();
      this.updateCartDisplay();
      this.ensureCartStaysOpen();
    }
  }

  updateCartDisplay() {
    const cartItems = document.querySelector('.cart-items');
    const totalAmount = document.querySelector('.total-amount');
    if (!cartItems || !totalAmount) return;

    if (this.items.length === 0) {
      cartItems.innerHTML = '<p style="text-align: center; padding: 20px; color: #666;">Your cart is empty</p>';
      totalAmount.textContent = '$0.00';
      return;
    }

    cartItems.innerHTML = this.items.map((item, index) => `
      <div class="cart-item">
        <img src="${item.image}" alt="${item.name}">
        <div class="cart-item-details">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">$${item.price.toFixed(2)}</div>
        </div>
        <div class="quantity-controls">
          <button class="quantity-btn" onclick="cart.updateQuantity(${index}, ${item.quantity - 1})">-</button>
          <span class="quantity-display">${item.quantity}</span>
          <button class="quantity-btn" onclick="cart.updateQuantity(${index}, ${item.quantity + 1})">+</button>
        </div>
        <button class="remove-item" onclick="cart.removeItem(${index})" title="Remove">×</button>
      </div>
    `).join('');

    const total = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    totalAmount.textContent = `$${total.toFixed(2)}`;
  }

  updateCartCount() {
    const count = this.items.reduce((sum, item) => sum + item.quantity, 0);
    const el = document.querySelector('.cart-count');
    if (el) el.textContent = String(count);
  }

  showAddedMessage(product) {
    const message = document.createElement('div');
    message.style.cssText = `
      position: fixed;
      top: 100px;
      right: 20px;
      background: #28a745;
      color: white;
      padding: 15px 20px;
      border-radius: 6px;
      z-index: 1001;
      animation: slideIn 0.3s ease;
    `;
    message.textContent = `${product.name} added to cart!`;
    document.body.appendChild(message);
    setTimeout(() => { message.remove(); }, 3000);
  }

  saveCart() {
    localStorage.setItem('marinerx-cart', JSON.stringify(this.items));
  }

  loadCart() {
    const saved = localStorage.getItem('marinerx-cart');
    if (saved) {
      try { this.items = JSON.parse(saved) || []; } catch { this.items = []; }
    }
  }

  clearCart() {
    this.items = [];
    this.saveCart();
    this.updateCartDisplay();
    this.updateCartCount();
  }

  ensureCartStaysOpen() {
    const cartPanel = document.querySelector('.cart-panel');
    if (cartPanel && cartPanel.classList.contains('open')) {
      setTimeout(() => {
        if (cartPanel && !cartPanel.classList.contains('open')) {
          cartPanel.classList.add('open');
        }
      }, 0);
    }
  }
}

// Initialize cart when DOM is loaded
let cart;
document.addEventListener('DOMContentLoaded', () => {
  cart = new ShoppingCart();
  // Hydrate any tile elements from catalog (title/price) where data-sku is present
  try {
    const catalog = (window.PRODUCT_CATALOG || {});
    document.querySelectorAll('[data-sku]').forEach((el) => {
      const sku = el.getAttribute('data-sku') || '';
      const c = catalog[sku];
      if (!c) return;
      const title = el.querySelector('h3');
      if (title && c.name) title.textContent = c.name.replace(/\s*\(.*\)$/,'');
      const priceEl = el.querySelector('.price');
      if (priceEl && typeof c.price === 'number') priceEl.textContent = `$${c.price.toFixed(2)}`;
      // Accessory name/price rows
      const accName = el.querySelector('.accessory-name');
      if (accName && c.name) accName.textContent = c.name;
      const accPrice = el.querySelector('.accessory-price');
      if (accPrice && typeof c.price === 'number') accPrice.textContent = `$${c.price.toFixed(2)}`;
      const img = el.querySelector('img.tile-thumb');
      if (img) {
        if (c.image && c.image.src) {
          img.src = c.image.src;
          if (c.image.alt) img.alt = c.image.alt;
          img.style.display = 'block';
        } else {
          // No image defined: keep it hidden to avoid empty box
          img.style.display = 'none';
        }
      }
    });

    // Accessory rows can show an icon if we inject a placeholder <img class="acc-thumb">
    document.querySelectorAll('.accessory-row').forEach((row) => {
      const btn = row.querySelector('[data-add-to-cart][data-id]');
      if (!btn) return;
      const sku = btn.getAttribute('data-id');
      const c = catalog[sku];
      if (!c || !c.image || !c.image.src) return;
      // Insert thumbnail at start of accessory-info if not present
      const info = row.querySelector('.accessory-info');
      if (!info) return;
      const existing = info.querySelector('img.acc-thumb');
      if (existing) {
        existing.src = c.image.src;
        if (c.image.alt) existing.alt = c.image.alt;
        info.classList.add('with-thumb');
        return;
      }
      const img = document.createElement('img');
      img.className = 'acc-thumb';
      img.src = c.image.src;
      if (c.image.alt) img.alt = c.image.alt;
      info.prepend(img);
      info.classList.add('with-thumb');
    });
  } catch (e) { /* non-blocking */ }
});

// Global helpers for product pages
window.addToCart = function(product) {
  if (!cart) return;
  try {
    const catalog = (window.PRODUCT_CATALOG || {});
    const fromCatalog = catalog[product.id];
    if (!fromCatalog) throw new Error('Missing catalog entry for ' + product.id);
    cart.addItem({
      id: product.id,
      name: fromCatalog.name,
      variant: product.variant || 'standard',
      price: Number(fromCatalog.price),
      quantity: Number(product.quantity || 1),
      image: (fromCatalog.image && fromCatalog.image.src) || ''
    });
  } catch (err) {
    console.warn('addToCart error:', err);
    alert('This item is being updated. Please try again later.');
  }
};

// Quantity helper (if any legacy quantity inputs remain)
window.updateQuantity = function(type, change) {
  const input = document.getElementById(`qty-${type}`);
  if (!input) return;
  const newValue = Math.max(1, Math.min(10, parseInt(input.value || '1', 10) + change));
  input.value = String(newValue);
};

// Add CSS animation for cart messages
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
`;
document.head.appendChild(style);
