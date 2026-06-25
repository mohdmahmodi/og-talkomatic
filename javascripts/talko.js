/*
**	=================
**	Talkomatic Client
**	=================
**
**	Author:	David R. Woolley (Core Logic)
**		Steven J. Zoppi  (Maintenance)
**
**	Copyright (c) 2014-2017 Thinkofit, Inc.
**		http://www.thinkofit.com
**
**	Copyright (c) 2018 Steven J. Zoppi
**
**	This code runs in the browser when a user is in a Talkomatic room.
**
**	Last changed	11/13/2015 (DRW)
**	SJZ20180126:	Cleanup / Documentation and pruning of all non-core
**			files and code.
*/




var privacyPRIVATE		= 2;
var privacySEMIPRIVATE	= 1;
var privacyPUBLIC		= 0;

var maxSlotsPerRoom = 5;

var TG = { 					// Container for Talkomatic globals

	roomPrivacy: '',		// Privacy setting of room (0=public, 1=semi-private, 2=private)
	roomHost: '',			// Room host's slot number
	myUserid: '',			// User's unique ID
	myName: '',				// User's name
	myNameClean: '',		// User's name cleaned for HTML display
	myLoc: '',				// User's location
	myLocClean: '',			// User's location cleaned for HTML display
	myAuth: '',				// User's 3rd party authenticator
	myLink: '',				// User's 3rd party profile URL
	myRoom: '',				// Name of room user is in
	myPrivacy: '',			// User's privacy code (blank or 0 = public, 1 = semi-private, 2 = private)
	myKey: '',				// User's room key
	myRoomSpecs: '',		// User's room specs
	mySlot: '',				// User's slot in room (0..4)
	myBlather: '',			// jQuery handle on user's own textarea
	myOldtext: '',			// Previous version of user's text (before current keypress)
	myOldlth: 0,			// Length of previous text
	myWidth: 0,				// Pixel width of user's textarea
	myHeight: 0,			// Pixel height of user's textarea
	charWidth: 0,			// Average pixel width of one character
	charsPerLine: 0,		// Estimated number of characters per line in textareas
	cplFudge: 12,			// Chars per line fudge factor. Increase if scrolling deletes too much, decrease if too little
	sound: true,			// Entry bell:  true = on, false = off
	changeCkTime: 2000,		// How often to check for text change, even without keypress (milliseconds)
	sendPokeTime: 10000,	// How often to send heartbeat signal to server (milliseconds)
	waitPokeTime: 20000,	// Time to allow server to send us something before deciding connection is lost
	changeCkFunc: '',		// setInterval handler function for change check (in case keyup/keydown don't catch a text change)
	lostConnectFunc: '',	// Timeout handler function invoked if we don't hear from server
	exitSent: false,		// Set to TRUE when we have transmitted our exit to the server
	socket: '',
	chatApp: ''
};

/* 
**	Connect to the socket
*/

TG.socket = io.connect();
yak("Socket: " + TG.socket);

var Chat = function (socket) {
	this.socket = socket;
};

TG.chatApp = new Chat(TG.socket);
yak("chatApp: " + TG.chatApp);

Chat.prototype.sendMessage = function (text) {
	this.socket.emit('message', text);
};

$(window).on("unload", function(e) {
	if (!TG.exitSent)
	{
		TG.exitSent = true;
		sendomatic('X'); // Tell server I'm leaving
	};
});

/*
**	Create a styled "alert" dialog box using jQueryui
*/
$.extend({ alert: function (message, title) {
	"use strict";
	if (!title) {
		title = $('#alert_title').html();
	}
	$("<div></div>").dialog( {
		buttons: { "Ok": function () { $(this).dialog("close"); } },
		close: function (event, ui) { $(this).remove(); },
		resizable: false,
		show: { effect: "fade", duration: 600 },
		modal: true,
		title: title
  }).html(message);
}
});

/*
**	Send a message to the server
*/
function sendomatic(message) {
	TG.chatApp.sendMessage(message);
	// yak ("Sent: " + message);
}

/*
**	Lost server connection check:  
**		Reset timer every time we receive a message from server.
**		Issue message if timer times out - meaning the server 
**		died or we lost the connection. 
*/
 
function serverWaitTimer() {
	if (TG.lostConnectFunc) {
		clearTimeout(TG.lostConnectFunc);
	}
	TG.lostConnectFunc = setTimeout(
			function () {
			$("#noconnect").removeClass("invisible").addClass("display_table");
			$("#noconnect").css('visibility', 'visible');
		}, TG.waitPokeTime);
}

/*
**	Turn sounds on or off. 
**		Call with no argument to toggle, 
**		true to turn on, false to turn off.
*/
function sound_toggle(onoff) {
	var imgonoff;

	if (onoff == undefined) {
		TG.sound = !TG.sound;
	} else {
		TG.sound = onoff;
	}
	imgonoff = TG.sound ? "speaker_on" : "speaker_off";
	$("#sound").html('<a href="#" onclick="sound_toggle();"><img src="/images/' + imgonoff + '.png" title="Sound On/Off" style="height:24px;"></a>');
}

/*
**	Show room privacy setting 
*/
function showPrivacy() {
	var privHtml;

	switch (parseInt(TG.roomPrivacy)) {
		case privacySEMIPRIVATE:
			privHtml = '<img src="/images/room_semiprivate.png" title="This room is Semi-Private" alt="Semi-Private" style="height:24px;"/>';
			$('#keyremind').addClass('invisible');
			break;
		case privacyPRIVATE:
			privHtml = '<img src="/images/room_private.png" title="This room is Private" alt="Private" style="height:24px;"/>';
			$('#keyremind').removeClass('invisible');
			break;
		default:
			privHtml = '<img src="/images/room_public.png" title="This room is Public" alt="Public" style="height:24px;"/>';
			$('#keyremind').addClass('invisible');
			break;
	}
	$("#privacy").html(privHtml);
}

/*
**	split_rem:  
**		Like the .split method, but when a limit is specified the remainder
**		of the string is added as a final array element instead of being discarded.
**			Example:  var ary = split_rem("a|b|c|d", "|", 2);
**			Result:  ary[0] = "a", ary[1] = "b", ary[2] = "c|d" 
*/

function split_rem(str, separator, limit) {
	str = str.split(separator);

	if (str.length > limit) {
		var ret = str.splice(0, limit);
		ret.push(str.join(separator));
		return ret;
	}
	return str;
}

/* Read cookies to find out who I am and where I am */
function getIdentity() {
	var cookies = getCookies();

	TG.myName		= cookies.username;
	TG.myNameClean	= cookies.usernameClean;
	TG.myLoc		= cookies.userloc;
	TG.myLocClean	= cookies.userlocClean;
	TG.myUserid		= cookies.userid;
	TG.myRoom		= cookies.userroom;
	/* Following cookies could be undefined - if so, save as empty strings. */
	TG.myAuth		= (typeof(cookies.userauth) !== 'undefined' ? cookies.userauth : '');
	TG.myLink		= (typeof(cookies.userlink) !== 'undefined' ? cookies.userlink : '');
	TG.myPRKey		= (typeof(cookies.userPRkey) !== 'undefined' ? cookies.userPRkey : '');
	TG.mySPRKey		= (typeof(cookies.userSPRkey) !== 'undefined' ? cookies.userSPRkey : '');
	TG.myPrivacy	= parseInt(cookies.privacy === undefined ? 0 : (cookies.privacy === '' ? 0 : cookies.privacy ));
	TG.myRoomSpecs	= (typeof(cookies.userroomspecs) !== 'undefined' ? cookies.userroomspecs : '');
	/* The classic client only has public and private rooms, so the room key
	** sent on entry is simply the user's private-room key. (Previously this was
	** left blank, so private rooms could never be unlocked on entry.) */
	TG.myKey		= TG.myPRKey;
}

function createSlots() {
	/*
	**	Generate HTML for talker slots. Slots are numbered 0 through N-1.
	**
	**	All element ID's have the slot number appended to the ID: 
	**		e.g., "slot4", "slothead4", "userloc4", "text4"
	*/

	var all_slots = '';
	var slot_html;
	var slots_per_room = maxSlotsPerRoom ; // Number of slots in a room
	yak("roomspecs=" + TG.myRoomSpecs + " myname=" + TG.myName);
	/* In normal horizontal slot layout textareas are 4 rows, 60 columns. In vertical layout, 24 rows of 30 columns. */
	var slot_rows = (TG.myRoomSpecs == "v") ? "24" : "4"; // Number of rows for each textarea
	var slot_cols = (TG.myRoomSpecs == "v") ? "30" : "60"; // Number of columns for each textarea

	for (var slot = 0; slot < slots_per_room; slot++) {

		slot_html = '<div id="slot' + slot + '" class="slot">'
			 + '<div id="slothead' + slot + '" class="slothead">&nbsp;'
			 + '<div id="userloc' + slot + '" class="userloc"></div>'
			 + '</div><!-- slothead' + slot + ' -->'
			 + '<textarea id="text' + slot + '" name="text' + slot 
			 + '" rows="' + slot_rows + '" cols="' + slot_cols + '"></textarea>'
			 + '</div><!-- slot' + slot + ' -->';

		all_slots += slot_html;
	}
	$("#slots").html(all_slots);
}

/* 
**	Initialize a slot when somebody enters or leaves the room	
*/
function slotInit(slot, uname, uloc, auth, url) {

	var displayName = unameDisplay(uname, auth, url); // Add authenticator icon and profile link, if any

	$('#slothead' + slot).html('<span class="username">' + displayName + 
		'</span><div id="userloc' + slot + '" class="userloc">' + uloc + '</div>');
	$('#text' + slot).val('');
	yak('uname=' + uname);
}

/* Clear a slot when somebody leaves */
function slotClear(slot) {
	$('#text' + slot).val('');
	$('#slothead' + slot).html('&nbsp;');
}

/* Do initial setup when I enter a room */
function enterRoom() {

	/* Display room name in room header */
	$('#roomname').html(TG.myRoom);

	/* Show room name in page title */
	document.title += ": " + TG.myRoom;

	/*
	**	Display room invitation URL. 
	**	Use period (46) as the zvvyCode escape because it takes minimal screen space.
	**	We drop the 8-character zvvyCode prefix to shorten and simplify the URL.
	**	This will require reinstating the prefix when someone enters via the displayed URL. 
	*/
	var zvvyroom = toZvvyCode(TG.myRoom, 46); /* .substring(8); */
	var url = window.location.protocol + '//' + window.location.host + '/index?r=' + zvvyroom;
	$('#invitelink').html('<a id=class="w3-medium w3-text-aqua w3-center" href="' + url + '">' + url + '</a>');
	/* Added 2/7/2017: show zvvyroom */
	yak('TG.myroom=' + TG.myRoom + ' zvvyroom=' + zvvyroom);

	/* Tell server who and where I am */
	sendomatic( 'E|' + TG.myNameClean + '|' + TG.myLocClean + '|' + TG.myAuth + 
				 '|' + TG.myLink      + '|' + TG.myRoom     + '|' + TG.myUserid + 
				 '|' + TG.myPrivacy   + '|' + TG.myKey      + '|' + TG.myRoomSpecs);
	yak('entering room - myLink = ' + TG.myLink);
}

/* Setup after we find out what slot I'm in */
function getMySlot(slot) {

	TG.mySlot = slot;
	var slotInRange = (slot >= 0 && slot <= maxSlotsPerRoom);
	var rulerWidth = 80;
	var rulerChars = 78;

	if ( slotInRange ) {
		/* Add "mySlot" class to my slot header and textarea */
		$('#slot' + TG.mySlot).addClass('myslot');
		$('#text' + TG.mySlot).addClass('myslot');
	}

	/* Make all textareas read-only except my own */
	$('textarea').not('.myslot').attr('readOnly', true);

	/* Inhibit the selection of slots that aren't mine by tabkey behavior */
	$('textarea').not('.myslot').attr('tabindex', -1);

	if ( slotInRange ) {
		/* Initialize my slot with my name and location */
		slotInit(TG.mySlot, TG.myNameClean, TG.myLocClean, TG.myAuth, TG.myLink);

		/* Get a handle on my own textarea */
		TG.myBlather = $('textarea#text' + TG.mySlot)[0]; // [0] is needed because jquery returns an array

		/* Register handler for keypresses within my textarea */
		$(TG.myBlather).keydown(szoutgoing);
		$(TG.myBlather).keyup(szoutgoing);
	}
	
	TG.changeCkFunc = setInterval(szoutgoing, TG.changeCkTime); // Call outgoing regularly even if no keys were pressed

	serverWaitTimer(); // Initialize regular check to see if connection to server is still alive

	if ( slotInRange ) {
		$(TG.myBlather).focus();
		TG.myHeight = TG.myBlather.clientHeight; // Height of my textarea
		TG.myWidth = TG.myBlather.clientWidth;


		/*
		**	Calculate approx. characters per line, used to decide 
		**	how much to delete when scrolling text out of sight. 
		*/
		rulerWidth = $('#ruler')[0].offsetWidth;
		rulerChars = $('#ruler').html().length;
		TG.charWidth = rulerWidth / rulerChars;
		TG.charsPerLine = Math.round(TG.myWidth / TG.charWidth); // The logical value
		TG.charsPerLine = TG.charsPerLine - TG.cplFudge;

		/* When window is resized, recalculate characters per line */
		$(window).resize(function () {
			TG.myWidth = TG.myBlather.clientWidth;
			TG.charsPerLine = Math.round(TG.myWidth / TG.charWidth) - TG.cplFudge;
		});
	}
}

/* exitRoom - called when user clicks Exit button in room */
function exitRoom() {
	if (!TG.exitSent)
	{
		TG.exitSent = true;
		sendomatic('X'); // Tell server I'm leaving
	}
	golobby();
}

/*
**	====================
**	===== INCOMING =====
**	====================
**
**	Handle messages from the server. 
*/

function incoming(message) {

	yak("Received: " + message);

	serverWaitTimer(); // Received something from server, so reset timer

	/*
 	**	Split message into pieces.
	**		Note that we can't just split the 
	**		entire string using the vertical bar
	**		separator because the text portion 
	**		of U or A commands could include vertical bars. 
	*/

	var msgpart = split_rem(message, "|", 2);
	var command = msgpart[0]; 				// Get the one-letter command code
	var theslot = parseInt(msgpart[1]); 	// Get slot number sent with this message
	var therest = msgpart[2]; 				// Remainder of the message after command and slot
	var slotId	= '#slot' + theslot; 		// ID of the slot's main DIV
	var textId	= '#text' + theslot; 		// ID of the slot's textarea
	var textAr	= $('textarea' + textId)[0]; // Handle on the textarea
	var thetext;
	var scrollAmount;
	
	var mySlotInRange = (TG.mySlot >= 0 && TG.mySlot <= maxSlotsPerRoom);
	var theSlotInRange = (theslot >= 0 && theslot <= maxSlotsPerRoom);
	
	switch (command) {

	case 'U':	/* 
				**	Update (update to a talker's text):
				**		U|slot|deleteChars|changeIndex|newStuff 
				*/

		/*
		**	Nonsense values for deleteChars or changeIndex could cause 
		**	odd effects here but won't crash the program. 
		*/
		msgpart = split_rem(therest, "|", 2);
		thetext = $(textAr).val().substring(msgpart[0]); // Delete specified number of characters from beginning
		thetext = thetext.substring(0, msgpart[1]) + msgpart[2]; // Replace/Add new text at indicated start position
		$(textAr).val(thetext);

		scrollAmount = textAr.scrollHeight - textAr.clientHeight;
		if (scrollAmount > 0) { // Scroll down if necessary to keep bottom-most text visible
			$(textAr).scrollTop(scrollAmount);
		}
		break;

	case 'A':	/*
				**	All (all of a talker's information and text):  
				**		A|slot|name|location|3rd party authenticator|profile URL|text 
				*/

		msgpart = split_rem(therest, "|", 4);
		slotInit(theslot, msgpart[0], msgpart[1], msgpart[2], msgpart[3]); // Display user's name and location
		$(textAr).val(msgpart[4]); // Display user's text
		// $(textAr).scrollTop( textAr.scrollHeight - textAr.clientHeight );
		break;

	case 'X':	/* 
				**	Exit (talker exited):
				**		X|slot 
				*/
		if (theSlotInRange) {
			slotClear(theslot); // Clear the slot header and text
		}
		break;

	case 'E':	/* 
				**	Enter (new talker entered):
				**		E|slot|name|location|3rd party authenticator|profile URL 
				*/

		msgpart = therest.split("|");
		
		/*
		**	Respond by sending A command with full text. 
		**	Server adds slot, my name, and my location 
		**	and forwards it to new talker 
		*/
		slotInit(theslot, msgpart[0], msgpart[1], msgpart[2], msgpart[3]); // Display new user's name and location

		if (mySlotInRange) {
			sendomatic('A|' + $(TG.myBlather).val());
		}
		
		if (TG.sound && theSlotInRange) {
			/*
			**	Firefox plays the sound every time without redoing 
			**	the "new Audio" line below, but Chrome plays it 
			**	only once unless we redo this every time. 
			*/
			EntrySound = new Audio('/sounds/doorbell.mp3');
			EntrySound.play();
		}
		break;

	case 'W':	/*
				**	Where (server tells client what slot talker is in):
				**		W|(slot|'<rejection_code>')
				*/

		if (isNaN(theslot)) {
			/*
			**	Slot number empty or nonnumeric value means the room 
			**	is full or another problem code prevents entry.
			*/
			if (theslot === undefined) {
				$.alert("We received a message from the server that we don't understand (W:<undefined>)");
				break;
			}
			switch (theslot) {
				
				case 'full':
					$.alert("Oops - The room you requested is FULL.");
					break;
					
				case 'key':
					$.alert("Oops - The room you requested is requires a matching key.  " +
						"The key you provided doesn't unlock this room.  Please check with " +
						"the room host and try again.");
					break;
					
				case 'dup':
					$.alert("Oops - There is another person in that room by the same name " +
						"and location!  Please go back to the lobby and choose a different name " +
						"or location.");
					break;
				
				default:
					$.alert(`This is odd - We received a response from the server that we don't understand (W:${theslot}`);
					break;

			}
			break;
		} else {
			getMySlot(theslot);
		}
		break;


	case 'R':	/*
				**	Room info:
				**		R|host's slot|privacy code 
				*/
		TG.roomHost = theslot;
		TG.roomPrivacy = therest;
		showPrivacy();
		break;

	case 'P':	/*
				**	Poke (server tells client connection is still alive) 
				*/
		break;

	case 'Z':	/*
				**	Z-Return (server tells client to exit the room) 
				*/
		exitRoom();
		break;

	} // end of switch

} // END OF INCOMING


/*
**	 ====================  
**	 ===== OUTGOING =====  
**	 ====================  
**
**	Keypress event handler within the user's textarea - sends updates to server. 
*/


/*
**  This is a pre-filter function that actively suppresses the
**  default tab behavior on the keydown/up events.
*/

function szoutgoing(event){ 
	
	if (TG.mySlot < 0 || TG.mySlot > maxSlotsPerRoom ) {
		return;
	}
	
	if ( typeof(event) !== "undefined" )
	{
		// console.log(event.which);
		if (event.which == 9) {
			event.preventDefault();
		}
	}
	outgoing();
	}
	
function outgoing() {

	var mytext;		// text in my slot
	var mylth;		// length of mytext
	var delchars;	// number of characters deleted (scrolled off the top) on this keypress
	var newch;		// new character added to text
	var ix;			// index of line end when searching for text to scroll off
	
	  /* Get contents of my textarea */
	mytext = $(TG.myBlather).val();
	mylth = mytext.length;

	/*
	**	If there are now too many lines of text to fit in the text area, 
	**	delete topmost stuff until the remainder fits. 
	*/

	delchars = 0;
	while ((TG.myBlather.scrollHeight > TG.myHeight) && (mylth > TG.charsPerLine)) {
		
		/* If user has inserted a hard linebreak, delete stuff up to and including the linebreak. */
		ix = mytext.indexOf('\n') + 1;
		
		if (ix <= 0 || ix > TG.charsPerLine) {
			/*	No hard linebreak within what is probably the top line.
			Look for a space that is likely to be where the top line breaks. */
			ix = mytext.substring(0, TG.charsPerLine).lastIndexOf(' ') + 1;
		}
		
		if (ix <= 0) {
			/* If no spaces found, delete a fixed number of characters. */
			ix = TG.charsPerLine;
		}
		
		mytext = mytext.substring(ix);
		mylth = mytext.length;
		$(TG.myBlather).val(mytext);
		delchars += ix;
		// break;
	}

	/* Send update to server */

	if (mytext !== TG.myOldtext) { // If there has been a change

		/*
		**	If we scrolled stuff off the top, delete the same amount from the "old" version of the text so that
		**	checks for the common cases of adding/erasing one character at the end will still work.
		*/
		if (delchars > 0) {
			TG.myOldtext = TG.myOldtext.substring(delchars);
			TG.myOldlth = TG.myOldtext.length;
		}

		/*
		**	$('#debug1').html('mytext=' + mytext + ' mylth=' + mylth + ' oldtxt=' + TG.myOldtext + ' oldlth=' + TG.myOldlth +
		**	' mysubstr=' + mytext.substring(0, mylth-1) + ' char=' + mytext.charAt(mylth-1) +
		**	' iftest=' +( (mylth === (TG.myOldlth+1)) && (mytext.substring(0, mylth-1) === TG.myOldtext) ) );
		*/

		/* Common case 1: One character added to end */
		if ((mylth === (TG.myOldlth + 1)) && (mytext.substring(0, mylth - 1) === TG.myOldtext)) {
			newch = mytext.charAt(mylth - 1);
			sendomatic('U|' + String(delchars) + '|' + String(mylth - 1) + '|' + newch);
		}

		/* Common case 2:  One character erased from end */
		else if ((mylth === (TG.myOldlth - 1)) && (mytext === TG.myOldtext.substring(0, TG.myOldlth - 1))) {
			sendomatic('U|0|' + String(mylth) + '|');
		}

		/* Any more complex case - replace entire text */
		else {
			sendomatic('U|0|0|' + mytext);
		}

		/* Save current version of text for use in detecting changes next time through */
		TG.myOldtext = mytext;
		TG.myOldlth = mylth;
	}
} // END OF OUTGOING


/* Document Ready jQuery function - executed when document has finished loading */
$(document).ready(function () {

	/* Register handler for incoming messages from server */
	TG.socket.on('message', function (message) {
		incoming(message);
	});

	/* Fill globals with cookie values to find out who and where I am */
	getIdentity();

	/* In case someone gets here without a name or a room name, boot to lobby. */
	if (!TG.myName || !TG.myRoom) {
		golobby();
	}

	/* Load stylesheet */
	var cssFile = (TG.myRoomSpecs == "v") ? "talko_v.css" : "talko_h.css";
	if (TG.myRoomSpecs == "v") {
			gtag('event', 'enter.room.verticalOld');
	} else {
			gtag('event', 'enter.room.horizontalOld');
	}
	var cssLink = $("<link rel='stylesheet' type='text/css' href='/stylesheets/" + cssFile + "'>");
	$("head").append(cssLink);

	/* Generate HTML for slots */
	createSlots();

	/* Initial setup when user enters room */
	enterRoom();

	/* Turn sound on and show sound icon */
	sound_toggle(true);

	/* Set up heartbeat function to send a still-alive message */
	setInterval(function () {
		sendomatic('P');
	}, TG.sendPokeTime);

	/* Create popup advice for copying the invite link */
	$("#invite").hover(function () {
		$("#invitecopyp").html("Right-click the link for an option to copy it");
	}, function () {
		$("#invitecopyp").html("");
	});
});