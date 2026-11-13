// Healthy-foods database. Values are per 100 g (USDA FoodData Central where available,
// typical home-cooked values for Indian dishes). Cooked weight unless the name says raw/dry.
// units: ways to measure the food; g is grams per unit. The first unit is the default.

const F = (id, name, cat, kcal, p, c, f, fib, units, tags = '') => ({ id, name, cat, kcal, p, c, f, fib, units, tags });
const u = (label, g, qty = 1) => ({ label, g, qty });
const G = u('g', 1, 100);
const OZ = u('oz', 28.35, 4);
const CUP = (g) => u('cup', g, 1);
const TBSP = (g) => u('tbsp', g, 1);

export const FOOD_CATS = [
  { id: 'protein', name: 'Proteins', color: '#D8463B' },
  { id: 'veg', name: 'Vegetables', color: '#3FA66B' },
  { id: 'fruit', name: 'Fruits', color: '#E07A3B' },
  { id: 'carb', name: 'Grains & carbs', color: '#E7B53A' },
  { id: 'dairy', name: 'Dairy', color: '#C9CED6' },
  { id: 'fat', name: 'Nuts, seeds & fats', color: '#9B7BD4' },
  { id: 'drink', name: 'Drinks', color: '#3F7CE0' },
];

export const FOODS = [
  // ---------- proteins
  F('chicken-breast', 'Chicken breast, grilled', 'protein', 165, 31, 0, 3.6, 0, [u('piece (palm-size)', 120), OZ, G], 'chicken'),
  F('chicken-thigh', 'Chicken thigh, skinless', 'protein', 209, 26, 0, 10.9, 0, [u('thigh', 90), OZ, G], 'chicken'),
  F('tandoori-chicken', 'Tandoori chicken (no skin)', 'protein', 150, 25, 3, 4, 0.5, [u('piece', 100), G], 'chicken indian'),
  F('turkey-breast', 'Turkey breast', 'protein', 135, 30, 0, 1.5, 0, [OZ, u('slice', 28), G]),
  F('ground-turkey', 'Ground turkey 93% lean', 'protein', 176, 23, 0, 9.4, 0, [OZ, G]),
  F('lean-beef', 'Lean ground beef 95%', 'protein', 164, 25.4, 0, 6.4, 0, [OZ, G], 'beef'),
  F('sirloin', 'Sirloin steak, lean', 'protein', 183, 30, 0, 6.5, 0, [OZ, G], 'beef'),
  F('salmon', 'Salmon', 'protein', 206, 22, 0, 12.4, 0, [u('fillet', 150), OZ, G], 'fish'),
  F('tuna', 'Tuna, canned in water', 'protein', 116, 25.5, 0, 0.8, 0, [u('can (drained)', 120), OZ, G], 'fish'),
  F('tilapia', 'Tilapia / white fish', 'protein', 128, 26, 0, 2.7, 0, [u('fillet', 120), OZ, G], 'fish cod'),
  F('shrimp', 'Shrimp', 'protein', 99, 24, 0.2, 0.3, 0, [OZ, u('large shrimp', 8), G], 'prawn'),
  F('egg', 'Egg, whole', 'protein', 143, 12.6, 0.7, 9.5, 0, [u('large egg', 50, 2), G], 'eggs boiled omelette'),
  F('egg-white', 'Egg whites', 'protein', 52, 10.9, 0.7, 0.2, 0, [u('egg white', 33, 4), CUP(243), G], 'eggs'),
  F('tofu', 'Tofu, firm', 'protein', 144, 17.3, 2.8, 8.7, 2.3, [u('block slice (85 g)', 85), G], 'soy vegan'),
  F('paneer', 'Paneer', 'protein', 265, 18.3, 1.2, 20.8, 0, [u('cube (25 g)', 25, 4), G], 'indian cottage cheese'),
  F('soya-chunks', 'Soya chunks (dry)', 'protein', 345, 52, 33, 0.5, 13, [u('handful (30 g)', 30), G], 'soy indian meal maker'),
  F('edamame', 'Edamame, shelled', 'protein', 121, 11.9, 8.9, 5.2, 5.2, [CUP(155), G], 'soy'),
  F('lentils', 'Lentils, boiled', 'protein', 116, 9, 20.1, 0.4, 7.9, [CUP(198), G], 'dal masoor'),
  F('dal', 'Dal (moong/toor, light tadka)', 'protein', 105, 6.5, 15, 2.2, 4, [u('katori (150 g)', 150), CUP(240), G], 'indian lentil'),
  F('chana', 'Chickpeas / chana, cooked', 'protein', 164, 8.9, 27.4, 2.6, 7.6, [u('katori (150 g)', 150), CUP(164), G], 'indian chole'),
  F('rajma', 'Rajma / kidney beans, cooked', 'protein', 127, 8.7, 22.8, 0.5, 6.4, [u('katori (150 g)', 150), CUP(177), G], 'indian beans'),
  F('black-beans', 'Black beans, cooked', 'protein', 132, 8.9, 23.7, 0.5, 8.7, [CUP(172), G], 'beans'),
  F('moong-sprouts', 'Moong sprouts', 'protein', 30, 3, 5.9, 0.2, 1.8, [CUP(104), G], 'indian salad'),

  // ---------- vegetables (raw unless noted)
  F('broccoli', 'Broccoli', 'veg', 34, 2.8, 6.6, 0.4, 2.6, [CUP(91), G]),
  F('spinach', 'Spinach / palak', 'veg', 23, 2.9, 3.6, 0.4, 2.2, [CUP(30), G], 'greens'),
  F('kale', 'Kale', 'veg', 35, 2.9, 4.4, 1.5, 4.1, [CUP(21), G], 'greens'),
  F('salad-greens', 'Mixed salad greens', 'veg', 17, 1.2, 3.3, 0.3, 2.1, [u('bowl', 85), G], 'lettuce romaine'),
  F('cauliflower', 'Cauliflower / gobi', 'veg', 25, 1.9, 5, 0.3, 2, [CUP(107), G]),
  F('bell-pepper', 'Bell pepper / capsicum', 'veg', 31, 1, 6, 0.3, 2.1, [u('pepper', 120), G]),
  F('carrot', 'Carrot', 'veg', 41, 0.9, 9.6, 0.2, 2.8, [u('medium', 61), G]),
  F('cucumber', 'Cucumber', 'veg', 15, 0.7, 3.6, 0.1, 0.5, [u('half', 150), G], 'salad'),
  F('tomato', 'Tomato', 'veg', 18, 0.9, 3.9, 0.2, 1.2, [u('medium', 123), G]),
  F('onion', 'Onion', 'veg', 40, 1.1, 9.3, 0.1, 1.7, [u('medium', 110), G]),
  F('zucchini', 'Zucchini', 'veg', 17, 1.2, 3.1, 0.3, 1, [u('medium', 196), G]),
  F('green-beans', 'Green beans', 'veg', 31, 1.8, 7, 0.2, 2.7, [CUP(110), G]),
  F('asparagus', 'Asparagus', 'veg', 20, 2.2, 3.9, 0.1, 2.1, [u('spear', 16, 6), G]),
  F('brussels', 'Brussels sprouts', 'veg', 43, 3.4, 9, 0.3, 3.8, [CUP(88), G]),
  F('mushroom', 'Mushrooms', 'veg', 22, 3.1, 3.3, 0.3, 1, [CUP(70), G]),
  F('cabbage', 'Cabbage', 'veg', 25, 1.3, 5.8, 0.1, 2.5, [CUP(89), G]),
  F('okra', 'Okra / bhindi', 'veg', 33, 1.9, 7.5, 0.2, 3.2, [CUP(100), G], 'indian'),
  F('peas', 'Green peas', 'veg', 84, 5.4, 15.6, 0.2, 5.5, [CUP(160), G], 'matar'),
  F('beetroot', 'Beetroot', 'veg', 43, 1.6, 9.6, 0.2, 2.8, [u('medium', 82), G]),
  F('mixed-sabzi', 'Mixed veg sabzi (light oil)', 'veg', 75, 2.2, 9, 3.5, 3, [u('katori (150 g)', 150), G], 'indian curry'),

  // ---------- fruits
  F('banana', 'Banana', 'fruit', 89, 1.1, 22.8, 0.3, 2.6, [u('medium', 118), G]),
  F('apple', 'Apple', 'fruit', 52, 0.3, 13.8, 0.2, 2.4, [u('medium', 182), G]),
  F('blueberries', 'Blueberries', 'fruit', 57, 0.7, 14.5, 0.3, 2.4, [CUP(148), G], 'berries'),
  F('strawberries', 'Strawberries', 'fruit', 32, 0.7, 7.7, 0.3, 2, [CUP(152), G], 'berries'),
  F('raspberries', 'Raspberries', 'fruit', 52, 1.2, 11.9, 0.7, 6.5, [CUP(123), G], 'berries'),
  F('orange', 'Orange', 'fruit', 47, 0.9, 11.8, 0.1, 2.4, [u('medium', 131), G]),
  F('mango', 'Mango', 'fruit', 60, 0.8, 15, 0.4, 1.6, [CUP(165), G]),
  F('papaya', 'Papaya', 'fruit', 43, 0.5, 10.8, 0.3, 1.7, [CUP(145), G]),
  F('pineapple', 'Pineapple', 'fruit', 50, 0.5, 13.1, 0.1, 1.4, [CUP(165), G]),
  F('watermelon', 'Watermelon', 'fruit', 30, 0.6, 7.6, 0.2, 0.4, [CUP(152), G]),
  F('grapes', 'Grapes', 'fruit', 69, 0.7, 18.1, 0.2, 0.9, [CUP(151), G]),
  F('kiwi', 'Kiwi', 'fruit', 61, 1.1, 14.7, 0.5, 3, [u('kiwi', 69), G]),
  F('pomegranate', 'Pomegranate seeds', 'fruit', 83, 1.7, 18.7, 1.2, 4, [CUP(174), G], 'anar'),
  F('pear', 'Pear', 'fruit', 57, 0.4, 15.2, 0.1, 3.1, [u('medium', 178), G]),
  F('guava', 'Guava', 'fruit', 68, 2.6, 14.3, 1, 5.4, [u('fruit', 55), G], 'amrood'),
  F('dates', 'Dates (Medjool)', 'fruit', 277, 1.8, 75, 0.2, 6.7, [u('date', 24), G]),

  // ---------- grains & carbs
  F('oats', 'Oats (dry)', 'carb', 379, 13.2, 67.7, 6.5, 10.1, [u('½ cup (40 g)', 40), G], 'oatmeal porridge'),
  F('brown-rice', 'Brown rice, cooked', 'carb', 123, 2.7, 25.6, 1, 1.6, [CUP(195), u('katori (150 g)', 150), G], 'rice'),
  F('basmati', 'Basmati rice, cooked', 'carb', 130, 2.7, 28.2, 0.3, 0.4, [CUP(158), u('katori (150 g)', 150), G], 'rice white'),
  F('quinoa', 'Quinoa, cooked', 'carb', 120, 4.4, 21.3, 1.9, 2.8, [CUP(185), G]),
  F('roti', 'Whole wheat roti (no ghee)', 'carb', 264, 9.6, 51.6, 2.4, 8, [u('roti', 40, 2), G], 'chapati indian phulka'),
  F('ww-bread', 'Whole wheat bread', 'carb', 252, 12.4, 42.7, 3.5, 6, [u('slice', 32, 2), G], 'toast'),
  F('sweet-potato', 'Sweet potato, baked', 'carb', 90, 2, 20.7, 0.2, 3.3, [u('medium', 114), G]),
  F('potato', 'Potato, boiled', 'carb', 87, 1.9, 20.1, 0.1, 1.8, [u('medium', 173), G], 'aloo'),
  F('ww-pasta', 'Whole wheat pasta, cooked', 'carb', 149, 6, 30.1, 1.7, 3.9, [CUP(140), G]),
  F('millet', 'Millet, cooked', 'carb', 119, 3.5, 23.7, 1, 1.3, [CUP(174), G], 'bajra ragi jowar'),
  F('idli', 'Idli', 'carb', 146, 4.5, 30, 0.6, 1.4, [u('idli', 39, 3), G], 'indian south'),

  // ---------- dairy
  F('greek-yogurt', 'Greek yogurt, nonfat', 'dairy', 59, 10.3, 3.6, 0.4, 0, [u('cup (170 g)', 170), G], 'curd'),
  F('greek-yogurt-2', 'Greek yogurt, 2%', 'dairy', 73, 10, 3.9, 1.9, 0, [u('cup (170 g)', 170), G], 'curd'),
  F('cottage-cheese', 'Cottage cheese, 2%', 'dairy', 81, 10.5, 4.8, 2.3, 0, [u('½ cup', 113), G]),
  F('curd', 'Curd / dahi', 'dairy', 61, 3.5, 4.7, 3.3, 0, [u('katori (150 g)', 150), G], 'yogurt raita indian'),
  F('milk-2', 'Milk, 2%', 'dairy', 50, 3.3, 4.8, 2, 0, [CUP(244), G]),
  F('milk-skim', 'Milk, skim', 'dairy', 34, 3.4, 5, 0.1, 0, [CUP(245), G]),
  F('soy-milk', 'Soy milk, unsweetened', 'dairy', 33, 2.9, 1.7, 1.6, 0.4, [CUP(243), G]),

  // ---------- nuts, seeds & fats
  F('almonds', 'Almonds', 'fat', 579, 21.2, 21.6, 49.9, 12.5, [u('handful (28 g)', 28), u('almond', 1.2, 10), G]),
  F('walnuts', 'Walnuts', 'fat', 654, 15.2, 13.7, 65.2, 6.7, [u('handful (28 g)', 28), G]),
  F('cashews', 'Cashews', 'fat', 553, 18.2, 30.2, 43.9, 3.3, [u('handful (28 g)', 28), G]),
  F('peanuts', 'Peanuts', 'fat', 567, 25.8, 16.1, 49.2, 8.5, [u('handful (28 g)', 28), G]),
  F('peanut-butter', 'Peanut butter, natural', 'fat', 588, 25, 20, 50, 6, [TBSP(16), G]),
  F('avocado', 'Avocado', 'fat', 160, 2, 8.5, 14.7, 6.7, [u('half', 68), G]),
  F('chia', 'Chia seeds', 'fat', 486, 16.5, 42.1, 30.7, 34.4, [TBSP(12), G]),
  F('flax', 'Flaxseed, ground', 'fat', 534, 18.3, 28.9, 42.2, 27.3, [TBSP(7), G]),
  F('pumpkin-seeds', 'Pumpkin seeds', 'fat', 559, 30.2, 10.7, 49, 6, [TBSP(9), u('handful (28 g)', 28), G]),
  F('olive-oil', 'Olive oil', 'fat', 884, 0, 0, 100, 0, [u('tsp', 4.5), TBSP(13.5), G], 'cooking'),
  F('ghee', 'Ghee', 'fat', 900, 0, 0, 100, 0, [u('tsp', 5), TBSP(14), G], 'indian butter cooking'),
  F('dark-choc', 'Dark chocolate 85%', 'fat', 598, 7.8, 45.9, 42.6, 10.9, [u('square', 10, 2), G]),

  // ---------- drinks
  F('coconut-water', 'Coconut water', 'drink', 19, 0.7, 3.7, 0.2, 1.1, [CUP(240), G]),
  F('black-coffee', 'Black coffee', 'drink', 2, 0.3, 0, 0, 0, [CUP(240), G]),
  F('green-tea', 'Green tea', 'drink', 1, 0.2, 0, 0, 0, [CUP(240), G]),
  F('chai-light', 'Chai, low sugar, 2% milk', 'drink', 40, 1.6, 5.5, 1.2, 0, [CUP(200), G], 'tea indian'),
];

export const foodById = (id, custom = []) => FOODS.find((f) => f.id === id) || custom.find((f) => f.id === id);

// Macros for a quantity of a food. qty is in the chosen unit.
export function macrosFor(food, unitLabel, qty) {
  const unit = food.units.find((x) => x.label === unitLabel) || food.units[0];
  const g = unit.g * qty;
  const k = g / 100;
  const r1 = (v) => Math.round(v * 10) / 10;
  return { g: Math.round(g), kcal: Math.round(food.kcal * k), p: r1(food.p * k), c: r1(food.c * k), f: r1(food.f * k), fib: r1(food.fib * k) };
}
