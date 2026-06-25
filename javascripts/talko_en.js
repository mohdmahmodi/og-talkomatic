/*
**	=================
**	Talkomatic Client
**	=================
**
**	Author:	Steven J. Zoppi  (Current Version)
*			David R. Woolley (Original Version)
**		
**
**	Copyright (c) 2014-2017 Thinkofit, Inc.
**		http://www.thinkofit.com
**
**	Copyright (c) 2018 Steven J. Zoppi
**
**	Relevant Documents
**	https://tools.ietf.org/html/rfc6455
**
**	This code runs in the browser when a user is in a Talkomatic room.
*/

/*global
	$, yak, yakdoc, toZvvyJsafe, gtag, timestamp, delCookie, getCookies, newUserId,
	saveCookie, zvvySaveCookie, saveCookie, gotalk, cleanText, fromZvvyCode, unameDisplay 
	window, jQuery,
	Audio, clearInterval, clearTimeout, document, event, history, Image, location, name, navigator, Option, screen, setInterval, setTimeout, XMLHttpRequest
*/

/*jshint 
	latedef:nofunc,
*/

/*jslint
	maxerr:500,
	indent:false,
	white:true
*/



var privacyPRIVATE		= 2;
var privacySEMIPRIVATE	= 1;
var privacyPUBLIC		= 0;

var maxSlotsPerRoom = 5;

var TG = { 					//	Container for Talkomatic globals
	
	roomPrivacy: '',		//	Privacy setting of room (0=public, 1=semi-private, 2=private)
	roomHost: '',			//	Room host's slot number
	myUserid: '',			//	User's unique ID
	myName: '',				//	User's name
	myNameClean: '',		//	User's name cleaned for HTML display
	myLoc: '',				//	User's location
	myLocClean: '',			//	User's location cleaned for HTML display
	myAuth: '',				//	User's 3rd party authenticator
	myLink: '',				//	User's 3rd party profile URL
	myRoom: '',				//	Name of room user is in
	myPrivacy: '',			//	User's privacy code (blank or 0 = public, 1 = semi-private, 2 = private)
	myPRKey: '',			//	User's Private room key
	mySPRKey: '',			//	User's SemiPrivate room key (volatile)
	myRoomSpecs: '',		//	User's room specs
	mySlot: '',				//	User's slot in room (0..maxSlotsPerRoom-1)
	myBlather: '',			//	jQuery handle on user's own textarea
	myOldtext: '',			//	Previous version of user's text (before current keypress)
	myOldlth: 0,			//	Length of previous text
	myWidth: 0,				//	Pixel width of user's textarea
	myHeight: 0,			//	Pixel height of user's textarea
	charWidth: 0,			//	Average pixel width of one character
	charsPerLine: 0,		//	Estimated number of characters per line in textareas
	cplFudge: 12,			//	Chars per line fudge factor. 
							//		Increase if scrolling deletes too much, decrease if too little
	sound: true,			//	Entry bell:  true = on, false = off
	changeCkTime: 2000,		//	How often to check for text change, even without keypress (milliseconds)
	sendPokeTime: 10000,	//	How often to send heartbeat signal to server (milliseconds)
	waitPokeTime: 20000,	//	Time to allow server to send us something before deciding connection is lost
	changeCkFunc: '',		//	setInterval handler function for change check 
							//		(in case keyup/keydown don't catch a text change)
	lostConnectFunc: '',	//	Timeout handler function invoked if we don't hear from server
	exitSent: false,		//	Set to TRUE when we have transmitted our exit to the server
	socket: '',				//	This is the chat socket created on the default "room" and "namespace"
	useDisconnectMsg: true,	//	Suppress Disconnect Message if necessary	
	chatApp: ''				//
};

/* 
**	Connect to the socket
*/

// Create SocketIO instance, connect

TG.socket = io.connect();
yak("Socket: " + TG.socket);

//	Function to store our current socket
//	as of this point in time ...
var Chat = function (socket) {
	this.socket = socket;
};

//	Construct the chatApp Socket
TG.chatApp = new Chat(TG.socket);
yak("chatApp: " + TG.chatApp);

//	Define the function prototype so we can use "sendMessage"
//	instead of having to use the ".emit" syntax
Chat.prototype.sendMessage = function (text) {
	this.socket.emit('message', text);
};

//	Catch unloads so we can gracefully exit the system
//	from the SERVER'S perspective

$(window).on("unload", sendEXIT);

//	We need to call resize to make sure it fires at least once
fnResize();


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
function serverOnTimeout() {
	/*
	**	If we timed out because we never got a good connection 
	**	don't display anything here ... the alert already took
	**	care of that.
	*/
	if (TG.useDisconnectMsg) {
		$("#noconnect").removeClass("invisible").addClass("display_table");
		$("#noconnect").css('visibility', 'visible');
	}
}
		
function serverWaitTimer() {
	if (TG.lostConnectFunc) {
		clearTimeout(TG.lostConnectFunc);
	}
	TG.lostConnectFunc = setTimeout( serverOnTimeout, TG.waitPokeTime);
}

/*
**	Turn sounds on or off. 
**		Call with no argument to toggle, 
**		true to turn on, false to turn off.
*/
function sound_toggle(onoff) {
	var imgonoff;

	if (onoff === undefined) {
		TG.sound = !TG.sound;
	} else {
		TG.sound = onoff;
	}
	imgonoff = TG.sound ? "fa fa-bell-o" : "fa fa-bell-slash-o";
	$("#sound").html('<a href="#" onclick="sound_toggle();">Entry Bell<i class="' + imgonoff + '" style="margin-left:2px;"></i></a>');
}

/*
**	Show room privacy setting 
*/
function showPrivacy() {
	var privHtml;

	switch (TG.roomPrivacy) {
		case privacySEMIPRIVATE:
			privHtml = '<span>(Semi-Private Room)<i class="w3-margin-left fa fa-low-vision"></i></span>';
			$('#keyremind').addClass('invisible');
			break;
		case privacyPRIVATE:
			privHtml = '<span>(Private)<i class="w3-margin-left fa fa-key"></i></span>';
			$('#keyremind').removeClass('invisible');
			break;
		default:
			privHtml = '<span>(Public Room)<i class="w3-margin-left fa fa-handshake-o"></i></span>';
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
	
	/*
	**	In normal horizontal slot layout 
	**		textareas are 4 rows, 60 columns.
	**	In vertical layout
	**		textareas are 24 rows of 30 columns. 
	*/
	var slot_rows = (TG.myRoomSpecs === "v") ? "24" : "4"; // Number of rows for each textarea
	var slot_cols = (TG.myRoomSpecs === "v") ? "30" : "60"; // Number of columns for each textarea
	var slot;
	for (slot = 0; slot < slots_per_room; slot++) {

		slot_html = 
				'<div id="slot' + slot + '" class="slot invisible w3-container ' + ((TG.myRoomSpecs === "v") ? "w3-cell" : "") + '">' +
			 		'<div id="slothead' + slot + '" class="slothead username w3-dark-gray w3-text-sand">' +
			  			'<span id="waiting' + slot + 
						'" class="fa fa-terminal w3-align-left w3-margin-left"></span>Waiting ...' +
			 		'</div><!-- slothead' + slot + ' -->' +
					'<textarea id="text' + slot + '" name="text' + slot +
						'" rows="' + slot_rows + '" cols="' + slot_cols + '">' +
					'</textarea>' +
			 	'</div><!-- slot' + slot + ' -->';

		all_slots += slot_html;
	}
	$("#slots").html(all_slots);
	$("#slots").addClass((TG.myRoomSpecs === "v") ? "w3-cell-row" : "");
}

/*
**	CALLED FROM HTML
**	keyhelp
**		Called when user clicks LEARN MORE by Room choice on Open Room form 
*/
function keyhelp() {
	"use strict";	
	var helptext = $('#keyhelp').html();
	var helptitle = $('#keyhelp_title').html();
	
	$( "<div></div>" ).dialog({
		title: helptitle,
		dialogClass: "no-close",
		show: { effect: "fade", duration: 600 },
		close: function (event, ui) { $(this).remove(); },
		autoOpen: true,
		width: "90%",
		maxWidth: "768px",

		buttons: [
			{
			  text: "OK",
			  click: function() {
				$( this ).dialog( "close" );
			  }
			}
		]
	}).html(helptext);

	$(TG.myBlather).focus();

	gtag('event', 'talko.help');

}


function thumbsVote(direction, slot, evt) {
	console.log(direction, slot, evt);
	if (slot === parseInt(TG.mySlot)) {
		return;
	}
	if (direction === '-') {
		$("#text" + slot).addClass("w3-red")
	} else {
		$("#text" + slot).removeClass("w3-red")
		
	}
	sendomatic('V|' + direction + '|' + slot);
}

/* 
**	Initialize a slot when somebody enters or leaves the room	
*/
function slotInit(slot, uname, uloc, auth, url) {

	var displayName = unameDisplay(uname, auth, url); // Add authenticator icon and profile link, if any
	
	//	fa fa-thumbs-down	&#xf165;	
	//	fa fa-thumbs-o-down	&#xf088;	
	//	fa fa-thumbs-o-up	&#xf087;	
	//	fa fa-thumbs-up		&#xf164;				
	
	if (TG.myRoomSpecs === "v") {
		$('#slothead' + slot).html(
				`<p id="username${slot}" class="username" style="padding:2px;margin:2px;"><i class="fa fa-child" style="width:16px">&nbsp;</i>${displayName}</p>` +
				`<p id="userloc${slot}"  class="userloc" style="padding:2px;margin:2px;"><i class="fa fa-home" style="width:16px">&nbsp;</i>` +
					( (uloc === '') ? '<i class="w3-text-yellow" >On The Web</i>' : uloc) +
				`<span id="thumbsup${slot}" class="w3-text-green w3-right w3-middle" style="padding-right:2px;margin-right:2px;">
					<a href="#" onclick="thumbsVote('+',${slot},event);">
					<i class="fa fa-thumbs-o-up" style="width:16px"></i>
					</a>
				</span>
				<span id="thumbsdn${slot}" class="w3-text-red w3-right" style="padding-right:2px;margin-right:2px;">
					<a href="#" onclick="thumbsVote('-',${slot},event);">
					<i class="fa fa-thumbs-o-down" style="width:16px"></i>
					</a>
				</span>
				</p>`
				);
	} else {
		$('#slothead' + slot).html(
				`<span id="username${slot}" class="username" style="padding:2px;margin:2px;">
					<i class="fa fa-child" style="width:16px">&nbsp;</i>${displayName}
				</span>
				<span id="userloc${slot}"  class="userloc" style="padding:2px;margin:2px;">
					<i class="fa fa-home" style="width:16px">&nbsp;</i>` +
					( (uloc === '') ? '<i class="w3-text-yellow" >On The Web</i>' : uloc) +
				`</span>
				<span id="thumbsup${slot}" class="w3-text-green w3-right w3-middle" style="padding-right:2px;margin-right:2px;">
					<a href="#" onclick="thumbsVote('+',${slot},event);">
					<i class="fa fa-thumbs-o-up" style="width:16px"></i>
					</a>
				</span>
				<span id="thumbsdn${slot}" class="w3-text-red w3-right" style="padding-right:2px;margin-right:2px;">
					<a href="#" onclick="thumbsVote('-',${slot},event);">
					<i class="fa fa-thumbs-o-down" style="width:16px"></i>
					</a>
				</span>`
			);
	}
	$('#text' + slot).val('');
	$('#text' + slot).addClass('occupied');
	$('#slot' + slot).removeClass('invisible');
	$('#thumbsup' + slot).addClass('invisible');
	$('#thumbsdn' + slot).addClass('invisible');

	updateUsers();
	yak('uname=' + uname);
}

function updateUsers() {
	var ix;
	var users;
	var fdate = new Date();
	var foptions = {  
			weekday: "long", year: "numeric", month: "short",  
			day: "numeric", hour: "2-digit", minute: "2-digit"  
		};  
	var ftime = fdate.toLocaleDateString("en-US", foptions);  
	users = $('textarea.occupied').length;
	$('#usercount').html(`<b>${ftime}<br />${users} of ${maxSlotsPerRoom} Talkers Active</b>`);
	
	if (users > 2) {
		for ( ix = 0; ix < maxSlotsPerRoom ; ix += 1 ) {
			if (ix !== parseInt(TG.mySlot)) {
				$('#thumbsup' + ix).removeClass('invisible');
				$('#thumbsdn' + ix).removeClass('invisible');
			}
			
		}
	} else {
		for ( ix = 0; ix < maxSlotsPerRoom ; ix += 1 ) {
			if (ix !== parseInt(TG.mySlot)) {
				$('#thumbsup' + ix).addClass('invisible');
				$('#thumbsdn' + ix).addClass('invisible');
			}
			
		}
	}

}
	

/* Clear a slot when somebody leaves */
function slotClear(slot) {
	var waiting_html = `<span id="waiting${slot}" class="fa fa-terminal w3-align-left w3-margin-left"></span>Waiting ...`;
	$('#text' + slot).val('');
	$('#slothead' + slot).html(waiting_html);
	$('#text' + slot).removeClass('occupied');
	$("#text" + slot).removeClass("w3-red")
	$('#slot' + slot).addClass('invisible');
	updateUsers();
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
	$('#invitelink').html('<a class="w3-medium w3-text-aqua w3-center" href="' + url + '">' + url + '</a>');
	/* Added 2/7/2017: show zvvyroom */
	yak('TG.myroom=' + TG.myRoom + ' zvvyroom=' + zvvyroom);

	/* Tell server who and where I am */
	switch (TG.myPrivacy) {
		case privacyPRIVATE: {
	
			sendomatic( 'E|' + TG.myNameClean + '|' + TG.myLocClean + '|' + TG.myAuth + 
						 '|' + TG.myLink      + '|' + TG.myRoom     + '|' + TG.myUserid + 
						 '|' + TG.myPrivacy   + '|' + TG.myPRKey    + '|' + TG.myRoomSpecs);
			break;
		}
		case privacySEMIPRIVATE: {
	
			sendomatic( 'E|' + TG.myNameClean + '|' + TG.myLocClean + '|' + TG.myAuth + 
						 '|' + TG.myLink      + '|' + TG.myRoom     + '|' + TG.myUserid + 
						 '|' + TG.myPrivacy   + '|' + TG.mySPRKey    + '|' + TG.myRoomSpecs);
			break;
		}
		default: {
	
			sendomatic( 'E|' + TG.myNameClean + '|' + TG.myLocClean + '|' + TG.myAuth + 
						 '|' + TG.myLink      + '|' + TG.myRoom     + '|' + TG.myUserid + 
						 '|' + TG.myPrivacy   + '|' + ''            + '|' + TG.myRoomSpecs);
			break;
		}

	}
	
	yak('entering room - myLink = ' + TG.myLink);
}

function fnResize() {
	TG.myWidth = TG.myBlather.clientWidth;
	TG.charsPerLine = Math.round(TG.myWidth / TG.charWidth) - TG.cplFudge;
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
		/* Disable Thumbs Up and Down */
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
		$(window).resize(fnResize);
	}
}

/*
**	exitRoom
**		called when user clicks Exit button in room 
*/

function sendEXIT (e) {
	if (!TG.exitSent)
	{
		TG.exitSent = true;
		//	Semi-private rooms only passed this
		//	key temporarily and shouldn't be considered
		//	"persistent"
		if (TG.roomPrivacy === privacySEMIPRIVATE) {
			delCookie('userSPRkey');
		}
		sendomatic('X'); // Tell server I'm leaving
	}
}

function exitRoom (e) {
	sendEXIT();
	golobby();
}

function createAccessReqs( requestList ) {
	
	var htmlOut = '';
	var username;
	var userlocn;
	var fields;
	var fixname;
	var reqs = (requestList + '\n').split('\n');
	var ix = 0;
	
	if ( reqs.length <= 1 ) {
		return '';
	}
	
	for ( ix = 0; ix < (reqs.length - 1); ix++) {
		//	ensure that there are at least two fields
		fields = (reqs[ix] + "||").split("|");
		username = fields[0];
		userlocn = ( fields[1] === '' ? '(undisclosed)' : fields[1]);
		fixname = reqs[ix].replace(/&/g,'&amp;');
		htmlOut += 
		'<div id="accessrequest' + ix + '" class="w3-display-container w3-cell-row w3-text-">' +	
			'<p id="requestor' + ix + '" class="w3-medium w3-cell">' +
				'User <span class="w3-text-sand">' + username + 
				'</span> at location <span  class="w3-text-sand">' + userlocn + 
				'</span> wants to join the conversation.' +
			'</p>' +
			'<button id="granted' + ix + '" class="w3-small w3-cell w3-margin-right w3-button w3-green w3-border w3-border-orange w3-round" name="granted' + ix + '" value="granted' + ix + '" type="button" onclick="accessResponse(event,\'+\',\'' + fixname + '\');">Grant</button>' +
			'<button id="denied' + ix + '" class="w3-small w3-cell w3-margin-right w3-button w3-red w3-border w3-border-orange w3-round" name="denied' + ix + '" value="denied' + ix + '" type="button" onclick="accessResponse(event,\'-\',\'' + fixname + '\');">Deny</button>' +
		'</div><!-- accessrequest' + ix + ' -->';

	}
	return (htmlOut);
}

function accessResponse( evt, resp, subjUser ) {
	evt = (evt) ? evt : event;
	console.log(evt);
	$("#" + evt.currentTarget.parentElement.id).addClass("invisible");
	switch (resp) {
		case '+':
		case '-': {
			sendomatic('K|' + resp + '|' + subjUser);
			return;
		}
		default: {
			return;
		}
	}
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
	var command = msgpart[0]; 		// Get the one-letter command code
	var theslot = msgpart[1]; 		// Get slot number sent with this message
	var therest = msgpart[2]; 		// Remainder of the message after command and slot
	var slotId = '#slot' + theslot; 	// ID of the slot's main DIV
	var textId = '#text' + theslot; 	// ID of the slot's textarea
	var textAr = $('textarea' + textId)[0]; // Handle on the textarea
	var thetext;
	var genHTML = '';
	var users;
	var scrollAmount;
	var EntrySound;

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

	case 'K':	/*
				**	Knock (Knock on the door requesting access):  
				**		K|hosts-slot-number|<name|location>\n<name|location>..|
				*/

		//	theslot can be ignored because this is coming from outside
		//	the chat room ... so they can't get in yet.
		if ( therest === '' ) {
			genHTML = '';
			$("#accessrequests").addClass("invisible");
		} else {
			EntrySound = new Audio('/sounds/knocking.wav');
			EntrySound.play();
			genHTML = createAccessReqs(therest);
			$("#accessrequests").removeClass("invisible");
		}
		$('#requestlist').html(genHTML);

		//		The response to the server is
		//			"K" | ("grant"|"deny") | "<Username>|<UserLoc>"

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
			TG.useDisconnectMsg = false;
			
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
		TG.roomPrivacy = parseInt(therest);
		showPrivacy();
		break;

	case 'P':	/*
				**	Poke (server tells client connection is still alive) 
				*/

		updateUsers();
		break;

	case 'Z':	/*
				**	Z-ReturnToLobby (server tells client to exit the room) 
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
		if (event.which === 9) {
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
	
	//TODO: This routine needs some work ... The logic doesn't really work on
	//	on entry to the function - it keeps cutting off before it should
	//	TG.myBlather.scrollHeight should be related to rows but again,
	//	this logic needs to be reworked.
	while ((TG.myBlather.scrollHeight > TG.myHeight) && (mylth > TG.charsPerLine * TG.myBlather.rows)) {
		
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


function initTalkomatic() {
	
	var cssLink;
	var cssFile;

	/* Register handler for incoming messages from server */

	TG.socket.on('message', incoming);

	/* Fill globals with cookie values to find out who and where I am */
	getIdentity();

	/* In case someone gets here without a name or a room name, boot to lobby. */
	if (!TG.myName || !TG.myRoom) {
		golobby();
	}

	/* Load stylesheet */
	cssFile = (TG.myRoomSpecs === "v") ? "talko_v_en.css" : "talko_h_en.css";
	if (TG.myRoomSpecs === "v") {
			gtag('event', 'enter.room.vertical');
	} else {
			gtag('event', 'enter.room.horizontal');
	}
	
	/*
	**	Dynamically load the appropriate Stylesheet using JQuery
	*/
	
	cssLink = $("<link rel='stylesheet' type='text/css' href='/stylesheets/" + cssFile + "'>");
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
		$("#invitecopyp").html("<span class='w3-text-yellow w3-medium'><b>Right-click</b></span> the link for an option to copy it");
	}, function () {
		$("#invitecopyp").html("");
	});
}

/* Document Ready jQuery function - executed when document has finished loading */
$(document).ready(initTalkomatic);