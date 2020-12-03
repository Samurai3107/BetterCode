 /*
  *   Installing dependencies
  */

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql');
const low = require('lowdb')
var jwt = require('jsonwebtoken');
require('dotenv-safe').config()

const FileAsync = require('lowdb/adapters/FileAsync')

 /*
  *  Library to generate a unique id
  */

const uuid = require('node-uuid');

 /*
  *  Creating Node Mailer connection
  */

const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

 /*
  *  Creating the connection to the database 
  */

var config = require("../../config/database");
var connection = mysql.createConnection(config);
connection.connect();

/*
 *  Creating the web app and defining the port
 */

const app = express();
const port = 3000;

/*
 *  Importing controllers
 */

const User = require("./controllers/user.js");

 /*
  *  Creating sessions environment
  */

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: false
}));

 /*
  *  API Routes
  */

const adapter = new FileAsync('database/confirmations.json')
low(adapter).then(db => {
  app.post("/api/login", async (req, res) => {

    let email = req.body.email;
    let password = req.body.password;
    let recaptcha_token = req.body.recaptcha;

    if(email == "" || password == ""){
      // Empty form
      
      return res.send({status: "empty", message: "Some values of the form are empty."});
    }

    let user = new User(connection, process.env.RECAPTCHA_SECRET);

    let captcha_status = await user.check_captcha(recaptcha_token);
    if(!captcha_status) {
      // The captcha token is invalid.

      return res.send({status: "captcha", message: "The recaptcha token is invalid."});
    }

    let get_results = await user.check_login(email);
    if(get_results == undefined) {
      // The email or password are wrong.

      return res.send({status: "fail", message: "Incorrect email or password."});
    }

    if(await user.verify_password(password, get_results.password)) {
        // Success.

        if(get_results.email_verified) {

          let user_id = get_results.id;
          let user_email = get_results.email;
          let user_name = get_results.username;

          var token = jwt.sign({ user_id, user_email, user_name }, process.env.SECRET, {
            expiresIn: 43200 // expires in 12 hours
          });
          return res.send({status: "success", user: { auth: token, user_id: user_id, user_email: user_email, username: user_name }});
        } else {
          return res.send({status: "fail", message: "Please verify your email first."});
        }

      } else {

        // The email or password are wrong.

        return res.send({status: "fail", message: "Incorrect email or password."});
      }

  })

  app.post("/api/register", async (req, res) => {

    let first_name = req.body.first_name;
    let last_name = req.body.last_name;
    let email = req.body.email;
    let username = req.body.username;
    let password = req.body.password;
    let recaptcha_token = req.body.recaptcha;

    if(first_name == "" || last_name == "" || email == "" || username == "" || password == ""){
      // Empty form
      
      return res.send({status: "empty", message: "Some values of the form are empty."});
    }

    let user = new User(connection, process.env.RECAPTCHA_SECRET);

    let captcha_status = await user.check_captcha(recaptcha_token);
    if(!captcha_status) {
      // The captcha token is invalid.

      return res.send({status: "fail", message: "The captcha token invalid."});
    }

    let email_status = await user.check_email(email);
    if(email_status) {
      // Email is already in use.

      return res.send({status: "fail", message: "The email that you inserted is already in use."});
    }

    let username_status = await user.check_user(username);
    if(username_status) {
      // Username is already in use.

      return res.send({status: "fail", message: "The username that you inserted is already in use."});
    }

    let hashed_password = await user.generate_hash(password);

    connection.query("INSERT INTO users (first_name, last_name, username, email, password) VALUES (?, ?, ?, ?, ?);", [first_name, last_name, username, email, hashed_password], (err, rows) => {
      if(err) {
        if(err) console.log(err);
        res.send({status: "fail", message: "An unexpected error occurred, try again later."})
      } else {

        let generated_uuid = uuid.v4(); 

        db.get('emails')
        .push({ uuid: generated_uuid, email: email})
        .last()
        .write()

        let text_email = user.generate_email_text(generated_uuid);

        var mailOptions = {
          from: '"BetterCode" <bettercode.noreply@gmail.com>',
          to: email,
          subject: 'Verify your account',
          html: text_email
        };

        transporter.sendMail(mailOptions, function(error, info){
          if (error) {

            console.log(error);
            return res.send({status: "error", message:"Error while sending the email confirmation."});

          } else {

            return res.send({status: "success", message:"We have sent you a email, please confirm your email."});

          }
        });
      }
    });
  })

  app.get("/api/verification/:uuid", (req, res) => {

    let uuid = req.params.uuid;
    let get_info = db.get("emails").find({ uuid: uuid }).value();

    if(get_info != undefined) {
      
      let verified_email = get_info.email;
      db.get("emails").remove({uuid: uuid}).write();

      connection.query("UPDATE users SET email_verified = 1 WHERE email = ?", [verified_email], (err, rows) => {

        if(!err) {
          return res.redirect('http://localhost:8080?status=email_verified');
        } else {
          return res.redirect('http://localhost:8080?status=error_email');
        }
      })
    } else {
      return res.redirect('http://localhost:8080?status=error_email');
    }
  });

}).then(() => {
  app.listen(3000, () => console.log('listening on port 3000'))
})
