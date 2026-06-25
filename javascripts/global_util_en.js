/*
**	============================
**	Talkomatic utility functions
**	============================
**
**	Author:	David R. Woolley (Core Logic)
**			Steven J. Zoppi  (Maintenance)
**
**	Copyright (c)	2014-2017 Thinkofit, Inc.
**					http://www.thinkofit.com
**
**	Copyright (c)	2018 Steven J. Zoppi
**
**	This code runs in the browser when a user is in a Talkomatic room.
**
**	Last changed	11/13/2015 (DRW)
**	SJZ20180126:	Cleanup / Documentation and pruning of all non-core
**			files and code.
*/

function twodigit(val) {
	return ((val < 10) ? '0' + val : val.toString());
}

function timestamp(when) {
	if (!when) {
		when = new Date();
	}
	return (when.getUTCHours() - 6 + ':' + twodigit(when.getUTCMinutes()) + ':' + twodigit(when.getUTCSeconds()) + '.' + when.getUTCMilliseconds());
}

function yak(stuff) {
	console.log(timestamp() + ': ' + stuff);
}

function yakdoc(stuff) {
	if ($("#diag").length > 0) {
		$("#diag").append('<p>' + timestamp() + ': ' + stuff + '</p>');
	}
}

/*
**	 ZvvyCode:  Universal safe text encoding method
**
**	 		By David R. Woolley
**	 		Thinkofit, Inc.
**
**			For implementations in other languages and further information, see
**			http://just.thinkofit.com/zvvycode
**
**
**	 ZvvyCode is a text encoding method that converts virtually any text into a format that can
**	 be handled by virtually any programming language without the danger of there being characters
**	 embedded in the encoded text that have syntactic meaning in the language. An encoded string
**	 consists only of the ASCII letters (a-z and A-Z) and digits (0-9), plus one special escape
**	 character which is designated at the time of encoding and may be anything other than the
**	 ASCII letters and digits. An encoded string can be decoded without advance knowledge of the
**	 escape character, because the escape character is read from the beginning of the encoded string.
**
**		The escape character does not have to be a visible character at all. It can be, for example,
**		0 (ASCII null), 127 (ASCII del), 27 (ASCII esc), 255 (the last extended ASCII character)
**		or even a large Unicode character value. The only restriction is that it cannot be one of
**		the ASCII upper or lower case letters or numeric digits.
**
**		It doesn't matter if the text to be encoded happens to include instances of the escape character.
**
**
**
**		toZvvyCode: Convert a string to ZvvyCode encoding.
**
**		Arguments:
**
**			str		String to be encoded
**			escChr	Character code to use as the escape character, given as a numeric value.
**					(E.g., 92 or 0x5c to use backslash as the escape.)
**					MUST NOT BE A LETTER (a-z, A-Z) OR DIGIT (0-9). Any other character code is valid.
**
**		Returns:
**			ZvvyCode encoded string
**
*/

function toZvvyCode(str, escChr) {

	var i;
	var chr;
	var lth = str.length;
	var escChrStr = String.fromCharCode(escChr);
	var escUsed = false;

	// Begin with two escape characters, the "zvvy" identifier, and two more escapes.
	var rs = escChrStr + escChrStr + "zvvy" + escChrStr + escChrStr;

	for (i = 0; i < lth; i++) {
		chr = str.charCodeAt(i);
		if ((chr >= 0x30 && chr <= 0x39) || (chr >= 0x41 && chr <= 0x5A) || (chr >= 0x61 && chr <= 0x7A)) {
			// Copy a-z, A-Z, and 0-9 as-is.
			rs += str.charAt(i);
		} else {
			// Output a hex character value surrounded by escape characters.
			rs += escChrStr + chr.toString(16) + escChrStr;
			escUsed = true;
		}
	}
	// If escape was used, return encoded string, otherwise return original unchanged.
	return (escUsed ? rs : str);
}

/*
**	fromZvvyCode: Convert a ZvvyCode encoded string back to its original value.
**
**	Arguments:
**		str		String to be decoded
**
**	Returns:
**		Object with two properties:
**			text:	Decoded string
**			error:	-1 if successful
**					 0 if the string was determined to be not encoded and is returned unchanged
**					 2 or greater if the encoded string is malformed
**
**	An encoded string is considered malformed if any of the following occur:
**		* A value enclosed between two escape characters is not a valid hexadecimal number
**		* An opening escape character is not matched by a closing escape - i.e., the string ends
**		  before a terminating escape character is found.
**
**	In case of a malformed string, the returned object will contain:
**			text:	As much of the string as could be decoded before the error was encountered
**			error:	Position within the string where a problematic escape sequence began
*/

function fromZvvyCode(str) {

	var i,
	escPos,
	escVal,
	escChr,
	escChrStr;
	var lth = str.length;
	var retobj = {
		"text": '',
		"error": -1
	};

	if (lth < 8) {
		// If string is less than eight characters, it cannot be ZvvyCode, so return as is.
		retobj.text = str;
		retobj.error = 0;
		return (retobj);
	}

	escChr = str.charCodeAt(0); // First character should be the escape character used to encode this string
	escChrStr = str.charAt(0);
	if ((escChr >= 0x30 && escChr <= 0x39) || (escChr >= 0x41 && escChr <= 0x5A) || (escChr >= 0x61 && escChr <= 0x7A)) {
		// First character is a letter or digit, not a valid escape character -- means this is not ZvvyCode so return as is.
		retobj.text = str;
		retobj.error = 0;
		return (retobj);
	}
	if (escChrStr != str.charAt(1) || escChrStr != str.charAt(6) || escChrStr != str.charAt(7) || str.substring(2, 6) != "zvvy") {
		// First 8 characters do not follow ZvvyCode pattern -- means string is not ZvvyCode, so return as is.
		retobj.text = str;
		retobj.error = 0;
		return (retobj);
	}

	i = 8; // Start decoding after the first eight characters
	while (i < lth) {
		escPos = str.indexOf(escChrStr, i);
		if (escPos < 0) {
			// No more instances of the escape string found, so append remainder of string and we are done.
			retobj.text += str.substring(i);
			return (retobj);
		}
		retobj.text += str.substring(i, escPos); // Append all regular characters up to where escape was found
		i = escPos + 1; // Point to first character beyond the escape
		escPos = str.indexOf(escChrStr, i); // Find terminating escape
		if (escPos >= 0) {
			escVal = '0x' + str.substring(i, escPos);
			if (isNaN(escVal)) {
				// Value in the escape sequence is not a valid number
				retobj.error = i - 1;
				return (retobj);
			}
			retobj.text += String.fromCharCode(escVal);
			i = escPos + 1;
		} else {

			// Escape sequence was started but string ended with no terminating escape found.
			// This indicates a malformed string.
			// Return decoded text up to the beginning of the unterminated escape sequence,
			// and set error value to the character position where the escape sequence began.

			retobj.error = i - 1;
			return (retobj);
		}
	}
	return (retobj);
}

/*
**	Clean text:
**
**		Convert characters that would cause problems when 
**		displayed in web browsers to a safe form.
**		Vertical bar is also converted because Talkomatic 
**		uses it as a separator in client-server communication.
**		Quotes (double, 22 hex, and single, 27 hex) are 
**		converted to avoid problems with values embedded 
**		in Javascript code.
*/

function cleanText(text) {
	return (text
		.replace(/&/g, '&amp;')
		.replace(/\|/g, '&#124;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\x22/g, '&#34;')
		.replace(/\x27/g, '&#39;'));
}

/*
**	uncleanText:
**		Reverse the effects of cleanText
*/
function uncleanText(text) {
	return (text
		.replace(/&amp;/g, '&')
		.replace(/&#124;/g, '|')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#34;/g, '"')
		.replace(/&#39;/g, "'"));
}

/*
**	zvvyCode a string using underscore (95) as escape. 
**		Underscore is good because it is allowed
**		at the beginning of Javascript names. 
**		Hence, the encoded result is valid as the name of a
**		Javascript variable or property. 
*/
function toZvvyJsafe(text) {
	if ( typeof(text) == 'undefined' ) {
		return '';
	}
	return (toZvvyCode(text, 95));
}

/*
**	get_query:  
**		Parses the query string in the current URL and returns an object with parameter names and values.
**			
**			Example:  If URL is:  http://example.com?x=5&y&z=hello
**			get_query returns the object:{
**				x: "6",
**				y: undefined,
**				z: "hello"
**			}
*/
function get_query() {
	var url = location.href;
	var qs = url.substring(url.indexOf('?') + 1).split('&');
	for (var i = 0, result = {}; i < qs.length; i++) {
		qs[i] = qs[i].split('=');
		result[qs[i][0]] = decodeURIComponent(qs[i][1]);
	}
	return result;
}

/*
**	Save a cookie
*/
function saveCookie(cookieName, value) {
	document.cookie = cookieName + "=" + value;
	yak("Cookie saved: " + cookieName + "=" + value);
}

/*
**	zvvyCode a value, then save it as a cookie
*/
function zvvySaveCookie(cookieName, value) {
	document.cookie = cookieName + "=" + toZvvyJsafe(value);
	yak ("Cookie zvvySaved: " + cookieName + "=" + toZvvyJsafe(value));
}

/*
**	Read and decode all cookies. 
**
**		Plain text values are returned regardless of whether cookies were zvvyCoded.
**		Return value is an object with cookie names as 
**		properties and their values as property values.
**		For example,
**			the value of a cookie saved as "mycookie=oreo" 
**			can be accessed as r.mycookie.
*/
function getCookies() {
	var cookie = document.cookie;
	// yak ("cookies: " + cookie);
	var cookies = cookie.split("; ");
	var r = {};
	for (var i = 0; i < cookies.length; i++) {
		var f = cookies[i].split("=");
		if (typeof(f[1]) == 'undefined') {
			continue;
		}
		r[f[0]] = fromZvvyCode(f[1]).text;
		// yak ("GetCookie:" + f[0] + " VALUE:" + f[1] + " DECODED:" + r[f[0]]);
	}
	return r;
}

/*
**	Generate unique ID for a user 
*/
function userUniqueGen() {
	var dNow = new Date();
	var utc = new Date(dNow.getTime() + dNow.getTimezoneOffset() * 60000);
		var utcdate = utc.getFullYear().toString().substring(2) +
		twodigit(utc.getMonth() + 1) +
		twodigit(utc.getDate()) + '.' +
		twodigit(utc.getHours()) +
		twodigit(utc.getMinutes()) +
		twodigit(utc.getSeconds()) + '.' +
		utc.getMilliseconds();
	var rand = Math.random();
	var rands = rand + '_';
	var unique = utcdate + rands.substring(1, 5); // random number substring begins with period
	return (unique);
}

function newUserId() {
	saveCookie("userid", userUniqueGen());
}

/*
**	Format a user name for display, 
**	possibly with authenticator icon and profile link 
*/
function unameDisplay(uname, auth, url) {

	var icon = '';

	if (url) {
		/* If user has a profile URL, add icon before name and make the name a link to the profile */
		if (auth == 'Facebook') {
			icon = 'facebook_15.png';
		}
		if (icon) {
			icon = '<img src="/images/' + icon + '" class="profile-icon"> ';
		}
		uname = icon + '<a target="talko_profile" href="' + url + '">' + uname + '</a>';
	}

	return (uname);
}

/*
**	Find out what cookies are supported. Returns:
**		null	- no cookies
**		false	- only session cookies are allowed
**		true	- session cookies and persistent cookies are allowed
**				(though the persistent cookies might not actually be persistent, 
**				if the user has set them to expire on browser exit)
*/
function getCookieSupport() {
    var persist= true;
    do {
        var c= 'gCStest='+Math.floor(Math.random()*100000000);
        document.cookie= persist? c+';expires=Tue, 01-Jan-2030 00:00:00 GMT' : c;
        if (document.cookie.indexOf(c)!==-1) {
            document.cookie= c+';expires=Sat, 01-Jan-2000 00:00:00 GMT';
            return persist;
        }
    } while (!(persist= !persist));
    return null;
}

function setCookie(cname, cvalue, exdays, path) {
    
	var d = new Date();
	var expires;
	
	if ( typeof(path) === 'undefined' ) {
		path = '/';
	} else {
		if ( path.substr(0,1) != '/' ) {
			path = '/' + path;
		}
	}
	if ( typeof(exdays) === 'undefined') {
		expires = "";
	} else {			
		d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
		expires = ";expires="+d.toUTCString();
    }
	console.log(cname + "=" + cvalue +  expires + ";path=" + path);
	document.cookie = cname + "=" + cvalue +  expires + ";path=" + path;
}

function getCookie(cname) {
    var name = cname + "=";
    var ca = document.cookie.split(';');
    var i;
	var c;
	
	for(i = 0; i < ca.length; i++) {
        c = ca[i];
        while (c.charAt(0) == ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) === 0) {
            return c.substring(name.length, c.length);
        }
    }
    return "";
}

function delCookie(cname, path) {
    setCookie(cname,"",-1, path);
}

function checkCookie() {
    var user = getCookie("username");
    if (user !== "") {
        alert("Welcome again " + user);
    } else {
        user = prompt("Please enter your name:", "");
        if (user !== "" && user !== null) {
            setCookie("username", user, 365);
        }
    }
}

function setLobby( useNew ) {
	setCookie("newLobby", useNew, 365, '/');
	jumpOut();
}
	
function getLobby() {
	//	getCookie only returns strings
	//	this function returns a boolean
	//	or a null
	var newLobby = getCookie("newLobby");
	switch (newLobby) {
		case false:
		case 'false':
		{
			newLobby = false;
			break;
		}
		case true:
		case 'true':
		{
			newLobby = true;
			break;
		}
		default:
		{
			newLobby = null;
			break;
		}
	}
	return newLobby;
}

function fbLoginLoader(event){
	//  SZ 20180127
	//  Prevent getScript from appending the ?_<Timestamp> to the query to force
	//  breaking the cache... 
	$.ajaxSetup({ cache: true });
	$.getScript('javascripts/fblogin.js', function (e) {
	$.ajaxSetup({ cache: false });
	});
}

/*	
**	Send user to a room. 
**	Cookies must be set before calling this. 
*/
function gotalk() {


	if (getLobby()) {
		gtag('event', 'redirect.toRoom');
		window.location = "/talko_en.html";
	} else {
		gtag('event', 'redirect.toRoomOld');
		window.location = "/talko.html";
	}
}

/*
**	Send user to the lobby.
*/
function golobby() {

	var newLobby = getLobby();
	//	Default to New Lobby
	newLobby = ( newLobby === null ? true : newLobby );
	if (newLobby) {
		gtag('event', 'redirect.toLobby');
		window.location = "/lobby_en.html";
	} else {
		gtag('event', 'redirect.toLobbyOld');
		window.location = "/lobby.html";
	}
}
