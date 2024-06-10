const path = require('path')
const express = require('express')
const bodyParser = require('body-parser')
const app = express();

app.set("views", path.resolve(__dirname, 'templates'))
app.set("view engine", "ejs")
app.use(bodyParser.urlencoded({extended:false}))

require("dotenv").config({path: path.resolve(__dirname, ".env")})
const uri = process.env.MONGO_DB_URI
const databaseAndCollection = {db: process.env.MONGO_DB_NAME, collection: process.env.MONGO_COLLECTION}
const {MongoClient, ServerApiVersion} = require('mongodb')
const client = new MongoClient(uri, {serverApi: ServerApiVersion.v1})

let curr_user;
let deck_id;
let dealt = false;
let curr_balance;
let bet = 0;
let dealer_cards = []
let player_cards = []

app.get("/", (request, response) => {
    response.render("index")
})

app.get("/login", (request, response) => {
    response.render("login", {status: "Please Enter Your Username & Password"})
})

app.post("/login", async (request, response) => {
    let {username, password} = request.body
    let success = false
    try {
        await client.connect()
        let result = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).findOne({username: username})
        if(!result) {
            await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).insertOne({username: username, password: password, balance: 100})
            success = true
        }
    } catch(e) {
        console.error(e)
    } finally {
        await client.close()
    }
    if(success) {
        response.render("login", {status: "Account Created, Please Login"})
    } else {
        response.render("create_acct", {status: "Username Already Exists"})
    }
})

app.get("/create_acct", (request, response) => {
    response.render("create_acct", {status: "Please Create a New Username & Password"})
})

app.get("/leaderboard", async (request, response) => {
    let top_ten;
    try {
        await client.connect()
        let cursor = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).find({}).sort({balance:-1}).limit(10)
        let arr = await cursor.toArray()
        top_ten = arr.reduce((res, elem) => {return res + `<tr><td>${elem.username}</td><td>${elem.balance}</td></tr>`}, "")
    } catch(e) {
        console.error(e)
    } finally {
        await client.close()
    }
    response.render("leaderboard", {top_ten: top_ten})
})

app.post("/table", async (request, response) => {
    let {username, password} = request.body
    let success = false
    try {
        await client.connect()
        let result = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).findOne({username: username})
        if(result && result.password === password) {
            curr_balance = Number(result.balance)
            success = true
        }
    } catch(e) {
        console.error(e)
    } finally {
        await client.close()
    }

    if(success) {
        const result = await fetch("https://deckofcardsapi.com/api/deck/new/shuffle/?deck_count=1")
        const json = await result.json()
        curr_user = username
        deck_id = json.deck_id
        response.render("table", {dealer: cards_to_png(dealer_cards), dealer_total: "", player: cards_to_png(player_cards), player_total: "", message: "Welcome", balance: curr_balance})
    } else {
        response.render("login", {status: "Username or Password Is Incorrect"})
    }
})

app.post("/deal", async (request, response) => {
    let message = "Cards Already Dealt"
    let end = false
    if(!dealt) {
        dealt = true
        message = ""
        bet = Number(request.body.bet)
        curr_balance -= bet

        const result = await fetch(`https://deckofcardsapi.com/api/deck/${deck_id}/draw/?count=4`)
        const json = await result.json()
        dealer_cards[0] = json.cards[1]
        dealer_cards.push(json.cards[3])
        player_cards.push(json.cards[0], json.cards[2])

        if(cards_total(player_cards) === 21) {
            end = true
            if(cards_total(dealer_cards) === 21) {
                message = "Draw, Both Blackjack"
                curr_balance += bet
            } else {
                message = `Blackjack! You win ${bet}`
                curr_balance += 2*bet
            }
        } else if(cards_total(dealer_cards) === 21) {
            end = true
            message = `Dealer Blackjack! You lose ${bet}`
        }
    }
    response.render("table", {dealer: end?cards_to_png(dealer_cards):`<img src=${dealer_cards[0].image} width="100"><img src=https://deckofcardsapi.com/static/img/back.png width="100">`, dealer_total: end?cards_total(dealer_cards):"", player: cards_to_png(player_cards), player_total: cards_total(player_cards), message: message, balance: curr_balance})
    if(end) {
        end_round()
    }
})

app.post("/hit", async (request, response) => {
    let message = "Cards Not Yet Dealt"
    let end = false
    if(dealt) {
        message = ""
        if(cards_total(player_cards) < 21) {
            const result = await fetch(`https://deckofcardsapi.com/api/deck/${deck_id}/draw/?count=1`)
            const json = await result.json()
            player_cards.push(json.cards[0])
            if(cards_total(player_cards) > 21) {
                message = `Bust! You lose ${bet}`
            }
        }
        if(cards_total(player_cards) == 21) {
            end = true
            while(cards_total(dealer_cards) < 17) {
                const result = await fetch(`https://deckofcardsapi.com/api/deck/${deck_id}/draw/?count=1`)
                const json = await result.json()
                dealer_cards.push(json.cards[0])
            }
            let dealer_total = cards_total(dealer_cards)
            let player_total = cards_total(player_cards)
            if(dealer_total > 21) {
                message = `Dealer Bust! You win ${bet}`
                curr_balance += 2*bet
            } else if(dealer_total > player_total) {
                message = `You lose ${bet}`
            } else if(player_total > dealer_total) {
                message = `You win ${bet}`
                curr_balance += 2*bet
            } else {
                message = "Draw"
                curr_balance += bet
            }
        } else if(cards_total(player_cards) > 21) {
            end = true
            message = `Bust! You lose ${bet}`
        }
    }
    response.render("table", {dealer: end?cards_to_png(dealer_cards):`<img src=${dealer_cards[0].image} width="100"><img src=https://deckofcardsapi.com/static/img/back.png width="100">`, dealer_total: end?cards_total(dealer_cards):"", player: cards_to_png(player_cards), player_total: cards_total(player_cards), message: message, balance: curr_balance})
    if(end) {
        end_round()
    }
})

app.post("/stand", async (request, response) => {
    let message = "Cards Not Yet Dealt"
    let profit
    if(dealt) {
        message = ""
        while(cards_total(dealer_cards) < 17 || cards_total(dealer_cards) < cards_total(player_cards)) {
            const result = await fetch(`https://deckofcardsapi.com/api/deck/${deck_id}/draw/?count=1`)
            const json = await result.json()
            dealer_cards.push(json.cards[0])
        }
        let dealer_total = cards_total(dealer_cards)
        let player_total = cards_total(player_cards)
        if(dealer_total > 21) {
            message = `Dealer Bust! You win ${bet}`
            curr_balance += 2*bet
        } else if(dealer_total > player_total) {
            message = `You lose ${bet}`
        } else if(player_total > dealer_total) {
            message =`You win ${bet}`
            curr_balance += 2*bet
        } else {
            message = "Draw"
            curr_balance += bet
        }
    }
    response.render("table", {dealer: cards_to_png(dealer_cards), dealer_total: cards_total(dealer_cards), player: cards_to_png(player_cards), player_total: cards_total(player_cards), message: message, balance: curr_balance})
    end_round()
})

async function end_round() {
    dealt = false
    dealer_cards = [{image:"https://deckofcardsapi.com/static/img/back.png"}]
    player_cards = []
    await client.connect()
    await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).updateOne({username: curr_user}, {$set: {balance: curr_balance}})
    bet = 0
    await fetch(`https://deckofcardsapi.com/api/deck/${deck_id}/shuffle/`)
}

function card_value(card) {
    if(isNaN(card.value)) {
        if(card.value === "ACE") {
            return 11
        }
        return 10
    }
    return Number(card.value)
}

function cards_total(cards) {
    return cards.reduce((res, elem) => {return res + card_value(elem)}, 0)
}

function cards_to_png(cards) {
    return cards.reduce((res, elem) => {return res + `<img src=${elem.image} width="100">`}, "")
}

process.stdin.setEncoding("utf8");

if (process.argv.length != 3) {
    console.error("Usage index.js portNumber")
    process.exit(1)
}
const portNumber = process.argv[2]
app.listen(portNumber);
console.log(`Web server started and running at http://localhost:${portNumber}`);

process.stdin.on("readable", () => {
    const input = process.stdin.read();
    if (input !== null) {
        const command = input.trim();
        if (command === "stop") {
            process.exit(0);
        }
    }
    process.stdin.resume()
});