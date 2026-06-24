const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const connectDB = require('./config/db');
const User    = require('./models/User');
const Product = require('./models/Product');
const Order   = require('./models/Order');
const Wallet  = require('./models/Wallet');

const seed = async () => {
  await connectDB();
  console.log('🌱 Seeding DairyVerse database...');

  // Clear existing data
  await Promise.all([
    User.deleteMany({}),
    Product.deleteMany({}),
    Order.deleteMany({}),
    Wallet.deleteMany({}),
  ]);

  // ── Users ──
  const customer = await User.create({
    firstName:'Rajesh', lastName:'Kumar', email:'customer@demo.com',
    password:'demo123456', phone:'+91 98765 43210', role:'customer',
    address:'12 MG Road', city:'New Delhi', state:'Delhi', pin:'110001',
    gender:'Male', dob:'1990-05-15',
    referralCode:'RAJ850', referralCount:2, points:850, tier:'Gold',
  });

  const vendor = await User.create({
    firstName:'Green Valley', lastName:'Farms', email:'vendor@demo.com',
    password:'demo123456', phone:'+91 98765 43211', role:'vendor',
    storeName:'Green Valley Farms', bizType:'Dairy Farm',
    gst:'22AAAAA0000A1Z5', fssai:'12345678901234',
    address:'Plot 15, Industrial Area', city:'Gurugram', state:'Haryana', pin:'122001',
    verified:true, organicCert:true,
  });

  const admin = await User.create({
    firstName:'Admin', lastName:'User', email:'admin@demo.com',
    password:'demo123456', phone:'+91 98765 43212', role:'admin',
    dept:'Operations', empId:'EMP001',
  });

  console.log('✅ Users created');

  // ── Products ──
  const products = await Product.insertMany([
    { name:'Fresh Full Cream Milk', icon:'🥛', category:'Milk', price:62, vendorPrice:45, unit:'1L', stock:150, rating:4.8, organic:true, fat:'3.5%', protein:'3.2g', calories:'61 kcal', tags:['bestseller','fresh'], vendorId:vendor._id },
    { name:'Paneer', icon:'🧀', category:'Cheese', price:120, vendorPrice:88, unit:'200g', stock:80, rating:4.6, fat:'20%', protein:'18g', calories:'265 kcal', tags:['popular'], vendorId:vendor._id },
    { name:'Curd', icon:'🥣', category:'Curd', price:40, vendorPrice:30, unit:'400g', stock:120, rating:4.7, organic:true, fat:'3.1%', protein:'3.5g', calories:'98 kcal', tags:['probiotic'], vendorId:vendor._id },
    { name:'Butter', icon:'🧈', category:'Butter', price:90, vendorPrice:65, unit:'100g', stock:60, rating:4.5, fat:'80%', protein:'0.5g', calories:'717 kcal', vendorId:vendor._id },
    { name:'Pure Ghee', icon:'🫙', category:'Ghee', price:480, vendorPrice:360, unit:'500ml', stock:45, rating:4.9, organic:true, fat:'99.5%', protein:'0g', calories:'900 kcal', tags:['premium','bestseller'], vendorId:vendor._id },
    { name:'Mango Lassi', icon:'🥤', category:'Lassi', price:50, vendorPrice:35, unit:'300ml', stock:90, rating:4.4, fat:'2%', protein:'3g', calories:'120 kcal', tags:['seasonal'], vendorId:vendor._id },
    { name:'Vanilla Ice Cream', icon:'🍨', category:'Ice Cream', price:150, vendorPrice:110, unit:'500ml', stock:75, rating:4.6, fat:'10%', protein:'3.5g', calories:'207 kcal', tags:['popular'], vendorId:vendor._id },
    { name:'Flavoured Milk', icon:'🍫', category:'Milk', price:35, vendorPrice:25, unit:'200ml', stock:200, rating:4.3, fat:'3%', protein:'3g', calories:'150 kcal', tags:['kids'], vendorId:vendor._id },
  ]);

  console.log('✅ Products created');

  // ── Orders ──
  await Order.create([
    {
      orderId:'ORD1001', userId:customer._id,
      items:[{productId:products[0]._id,name:'Fresh Full Cream Milk',price:62,quantity:2,icon:'🥛'},{productId:products[2]._id,name:'Curd',price:40,quantity:1,icon:'🥣'}],
      subtotal:164, delivery:50, gstAmt:8, total:222,
      status:'delivered', address:'12 MG Road, New Delhi – 110001',
      payMethod:'upi', slot:'Morning (6 AM – 9 AM)', deliveryName:'Rajesh Kumar', deliveryPhone:'+91 98765 43210',
      cashbackAwarded:4, pointsAwarded:16,
    },
    {
      orderId:'ORD1002', userId:customer._id,
      items:[{productId:products[4]._id,name:'Pure Ghee',price:480,quantity:1,icon:'🫙'},{productId:products[1]._id,name:'Paneer',price:120,quantity:2,icon:'🧀'}],
      subtotal:720, delivery:50, gstAmt:36, total:806,
      status:'delivered', address:'12 MG Road, New Delhi – 110001',
      payMethod:'card', slot:'Evening (5 PM – 8 PM)', deliveryName:'Rajesh Kumar', deliveryPhone:'+91 98765 43210',
      cashbackAwarded:16, pointsAwarded:72,
    },
    {
      orderId:'ORD1003', userId:customer._id,
      items:[{productId:products[6]._id,name:'Vanilla Ice Cream',price:150,quantity:1,icon:'🍨'},{productId:products[5]._id,name:'Mango Lassi',price:50,quantity:2,icon:'🥤'}],
      subtotal:250, delivery:50, gstAmt:12, total:312,
      status:'in-transit', address:'12 MG Road, New Delhi – 110001',
      payMethod:'cod', slot:'Afternoon (12 PM – 3 PM)', deliveryName:'Rajesh Kumar', deliveryPhone:'+91 98765 43210',
    },
  ]);

  console.log('✅ Orders created');

  // ── Wallets ──
  await Wallet.create([
    {
      userId: customer._id, balance: 650,
      transactions: [
        { type:'credit', amount:500, desc:'Welcome bonus', date:new Date('2024-01-01') },
        { type:'credit', amount:100, desc:'Referral bonus – friend joined', date:new Date('2024-02-05') },
        { type:'credit', amount:4,   desc:'Cashback from ORD1001', date:new Date('2024-02-08') },
        { type:'credit', amount:16,  desc:'Cashback from ORD1002', date:new Date('2024-02-10') },
        { type:'debit',  amount:50,  desc:'Order payment ORD1004', date:new Date('2024-02-16') },
      ],
    },
    {
      userId: vendor._id, balance:38240,
      transactions: [
        { type:'credit', amount:6750,  desc:'Admin purchased Milk (150 units × ₹45)', date:new Date('2024-01-15') },
        { type:'credit', amount:7040,  desc:'Admin purchased Paneer (80 units × ₹88)', date:new Date('2024-01-16') },
        { type:'credit', amount:16200, desc:'Admin purchased Ghee (45 units × ₹360)', date:new Date('2024-01-18') },
        { type:'credit', amount:8250,  desc:'Admin purchased Ice Cream (75 units × ₹110)', date:new Date('2024-01-20') },
      ],
    },
    {
      userId: admin._id, balance:125000,
      transactions: [
        { type:'credit', amount:200000, desc:'Platform operating budget', date:new Date('2024-01-01') },
        { type:'debit',  amount:6750,   desc:'PO001 – Milk stock from Green Valley Farms', date:new Date('2024-01-15') },
        { type:'debit',  amount:7040,   desc:'PO002 – Paneer stock from Green Valley Farms', date:new Date('2024-01-16') },
        { type:'debit',  amount:16200,  desc:'PO003 – Ghee stock from Green Valley Farms', date:new Date('2024-01-18') },
        { type:'debit',  amount:8250,   desc:'PO004 – Ice Cream stock from Green Valley Farms', date:new Date('2024-01-20') },
        { type:'credit', amount:222,    desc:'Revenue: Order ORD1001', date:new Date('2024-02-08') },
        { type:'credit', amount:806,    desc:'Revenue: Order ORD1002', date:new Date('2024-02-10') },
      ],
    },
  ]);

  console.log('✅ Wallets created');
  console.log('\n🎉 Seed complete!\n');
  console.log('Demo credentials:');
  console.log('  Customer: customer@demo.com / demo123456');
  console.log('  Vendor:   vendor@demo.com   / demo123456');
  console.log('  Admin:    admin@demo.com     / demo123456');

  process.exit(0);
};

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
