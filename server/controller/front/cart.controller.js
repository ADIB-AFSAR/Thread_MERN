const cartModel = require("../../models/cart.model");
const cartItemModel = require("../../models/cartItem.model");
const orderModel = require("../../models/order.model");
const orderItemModel = require("../../models/orderItem.model");
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { v4: uuidv4 } = require("uuid");

const getCart = async (req, res) => {
    try {
        const currentCart = await cartModel.findOne({
            customer: req.user._id,
            placedOrder: false
        }).populate('customer');

        if (!currentCart) {
            return res.json({ currentCart: {} });
        }

        const response = await collectTotal(currentCart.id);
        res.json({ currentCart: response });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const addCart = async (req, res) => {
    console.log(req.body)
    try {
        const { id: productId } = req.params;
        const { size } = req.body; // Get size from request body
        let currentCart = await cartModel.findOne({
            customer: req.user._id,
            placedOrder: false
        });

        if (currentCart) {
            const item = await cartItemModel.findOne({
                product: productId,
                cart: currentCart._id,
                size // Check for both product and size
            });

            if (item) {
                await cartItemModel.updateOne({ _id: item._id }, {
                    quantity: item.quantity + 1
                });
            } else {
                await cartItemModel.create({
                    cart: currentCart._id,
                    product: productId,
                    quantity: 1,
                    size // Set size
                });
            }
        } else {
            currentCart = await cartModel.create({ customer: req.user._id });
            await cartItemModel.create({
                cart: currentCart._id,
                product: productId,
                quantity: 1,
                size // Set size
            });
        }

        const response = await collectTotal(currentCart._id);
        return res.json({ currentCart: response });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updateCart = async (req, res) => {
    try {
        const { itemId, cartId, quantity, size } = req.body; // Include size if necessary
        await cartItemModel.updateOne({ _id: itemId, cart: cartId }, {
            quantity: quantity,
            size: size // Update size if needed
        });
        const response = await collectTotal(cartId);
        return res.json({ currentCart: response });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const deleteCart = async (req, res) => {
    try {
        const item = await cartItemModel.findOne({ _id: req.params.id });
        if (item) {
            await cartItemModel.deleteOne({ _id: req.params.id });
            return res.status(200).json({ message: "Item deleted successfully" });
        } 
        return res.status(404).json({ message: "Item not found" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const collectTotal = async (id) => {
    const cart = await cartModel.findOne({ _id: id }).populate('customer');
    const cartItems = await cartItemModel.find({ cart: cart._id }).populate("product");

    let subTotal = 0;
    for (const item of cartItems) {
        subTotal += item.product?.price * item.quantity || 0; // Safely handle potential undefined price
    }

    const tax = 0; // You can adjust this based on your requirements
    const grandTotal = subTotal + tax;

    await cartModel.updateOne({ _id: id }, {
        subTotal: subTotal,
        tax: tax,
        grandTotal: grandTotal
    });

    return { ...cart._doc, items: cartItems };
};

const placeOrder = async (req, res) => {
    console.log("placeorder:",req.body, req.params)
    try {
        const cart = await cartModel.findOne({ _id: req.params.cartId });

        if (!cart) {
            return res.status(404).json({ message: "Cart not found" });
        }

        const cartItems = await cartItemModel.find({ cart: cart._id });

        const order = await orderModel.create({
            customer: cart.customer,
            subTotal: cart.subTotal,
            tax: cart.tax,
            grandTotal: cart.grandTotal,
            billingAddress: req.body.billingAddress,
            placedOrder : true                         //added to true
        });

        await Promise.all(cartItems.map(async (item) => {
            await orderItemModel.create({
                order: order._id,
                product: item.product,
                quantity: item.quantity,
                size: item.size // Include size
            });
        }));

        await cartModel.updateOne({ _id: cart._id }, { placedOrder: true });
        return res.json({ message: "Order placed successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const stripePay = async (req, res) => {
    try {
        const { token, amount } = req.body;
        const idempotencyKey = uuidv4();

        const customer = await stripe.customers.create({
            email: token.email,
            source: token.id
        });

        const result = await stripe.charges.create({
            amount: amount * 100,
            currency: "USD",
            customer: customer.id,
            receipt_email: token.email,
        }, { idempotencyKey });

        res.status(200).json({ result, message: "Payment successful" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getCart,
    addCart,
    deleteCart,
    updateCart,
    placeOrder,
    stripePay
};