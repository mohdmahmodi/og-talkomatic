/*
**	================================
**	Talkomatic Lobby JavaScript code
**	================================
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
**					files and code.
*/

var Cookies		= {		//	Global - Cookie values
	username: '',
	usernameClean: '',
	userloc: '',
	userlocClean: '',
	userauth: '',		//	3rd party authenticator, e.g. Facebook
	userlink: '',		//	Link to user's 3rd party profile
	userid: '',
	userPRkey: '',
	userPRkeyClean: '',
	userroom: '',
	userroomspecs: '',
	usergo: ''
};

var Roomdata;						//	Global - gets filled with room data by request to server.
var TimerFunc;						//	Global - timer function to refresh room data

var Old_Room_Count	= 0;			//	Count of open rooms the last time we checked
var Old_Peep_Total	= 0;			//	Total people in all rooms last time we checked

var maxROOMCAPACITY	= 5;			//	Maximum people per room
									//	(Must not exceed the number of slots shown in talko.html)
var Info_Name 		= "info>";		//	Name of pseudo-person in each room containing room settings

var privacyPRIVATE		= 2;
var privacySEMIPRIVATE	= 1;
var privacyPUBLIC		= 0;

/*
**	Always Open Public Rooms
**		Originally Hangout 247	(Doug and David)
**		Adding CERL 165 A/B and Cyber1
*/
var PermRooms		= ["Hangout 247", "CERL165A-B", "Cyber1"];

var Update_Time		= 4000;			//	How often to auto-update lobby display, in milliseconds. 0 for no auto-updates. Normally 4000.
var Last_Request;					//	Time when request to server was most recently issued
var Uhoh_Time		= 20000;		//	Issue "server down" alert after this much time without a response from the server 
var Last_Update		= Date.now();	//	Time when response from server was most recently received
var ServerUp		= true;			//	True if server is responding to requests



function nothing() {}				//	Can be used as a callback function to execute when we want to do nothing

/*
**	SJZ: Candidate for Removal
**
**	function loadit () {
**		$.getScript( "/javascripts/fblogin.js" )
**		  .done(function( script, textStatus ) {
**			console.log( textStatus );
**		  })
**		  .fail(function( jqxhr, settings, exception ) {
**			gtag('event', 'fb.load.failed');
**			console.log ('load failed');
**		});
**	}
*/

// Define "prop" function in case the current jQuery version does not support it.
// This code found at http://stackoverflow.com/questions/6323431/jquery-prop-compatibility
(function($){
    if (typeof $.fn.prop !== 'function')
    $.fn.prop = function(name, value){
        if (typeof value === 'undefined') {
            return this.attr(name);
        } else {
            return this.attr(name, value);
        }
    };
})(jQuery);


/*
**	Create a styled "alert" dialog box using jQueryui
*/
$.extend({ alert: function (message, title) {
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
  }).text(message);
}
});

/*
**	keyhelp
**		Called when user clicks LEARN MORE by Room choice on Open Room form 
*/
function keyhelp() {
	
	var helptext = $('#keyhelp').html();
	var helptitle = $('#keyhelp_title').html();
	
	$( "<div></div>" ).dialog({
		title: helptitle,
		dialogClass: "no-close",
		show: { effect: "fade", duration: 600 },
		close: function (event, ui) { $(this).remove(); },
		autoOpen: true,
		buttons: [
			{
			  text: "OK",
			  click: function() {
				$( this ).dialog( "close" );
			  },
			}
		]
	}).html(helptext);

	gtag('event', 'openroom.questionmarkOld');

}

/*
**	showMoreOpts
**		Called when user clicks "More options" on Open Room form 
*/
function showMoreOpts() {
	$("#layoutOpts").removeClass("invisible");
	$("#showMoreOpts").addClass("invisible");
	gtag('event', 'openroom.moreoptionsOld');
}


/*
**	list_rooms: 
**		Generate contents of the "chooseroom" div showing all active rooms and participants 
*/
function list_rooms() {

	var listdiv = $("div#roomlist")[0];	// Get a handle on the roomlist div
	var zroom;		// room name
	var zvvyroom;	// zvvyCoded room name
	var zpeep;		// person name
	var zloc;		// person location
	var zinfo;		// room information object (privacy setting, perhaps others)
	var privHtml;	// HTML indicating room privacy
	var roomHtml;	// used to build the HTML to display a room and its occupants
	var peepHtml;	// used to build HTML for people list
	var roomCount;	// number of rooms open
	var peepCount;	// number of people in a room
	var peepTotal;	// total of people in all rooms
	var titleExt;	// extension to add on to page title

	var enter_button_class = "room_enter";
	if (!Cookies.username) {
		enter_button_class += " invisible";	// Make Enter buttons invisible if username is unknown
	}

	/* Loop through the rooms. */
	roomCount = 0;
	peepTotal = 0;
	for (zroom in Roomdata) {
		/* zroom is now a room name (cleaned but not zvvyCoded). */
		
		//	This version does not support semi-private rooms
		zinfo = Roomdata[zroom][Info_Name]
		if (parseInt(zinfo.privacy) == privacySEMIPRIVATE) {
			continue;
		}
		
		roomCount++;

		/*	
		**	Create the HTML list of people in the room. 
		**	In the process we pick up room settings from 
		**	the "info>" pseudo-person in the room data. 
		*/
		peepCount = 0;
		peepHtml = '';
		for (zpeep in Roomdata[zroom]) {
			// yak("zpeep=" + zpeep);
			// yak("loc=" + Roomdata[zroom][zpeep]);
			if (zpeep === Info_Name) {
				zinfo = Roomdata[zroom][Info_Name];		// Get room settings
				// yak ("Room specs: " + zinfo.specs);
			} else {
				peepCount++;
				// DINGBAT CIRCLED SANS-SERIF DIGIT ONE = 10112
				// DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT ONE = 10122
				// Dingbat Negative Circled Digit One = 10102

				peepHtml +=
					'<div class="lobby_person">&nbsp;' + '&#' + ((peepCount - 1) + 10112) + ';&nbsp;&nbsp;' + zpeep + '&nbsp;' +
					'<span class="lobby_person_loc">&nbsp;/&nbsp;&nbsp;' + Roomdata[zroom][zpeep] + '&nbsp;</span>'
					+ '</div>'	// closes lobby_person
			}
		}
		peepTotal += peepCount;
		
		// yak ("peepCount=" + peepCount);
		if (peepCount == 0) {	
			peepHtml = '<div class="ui-accordion-content lobby_list_hidden">';
			if ( zinfo.privacy > privacyPUBLIC ) {	// private or semi-private room
				peepHtml += $('#peep_hidden').html();
			} else {					// public room
				peepHtml += $('#peep_empty').html();
			}
			peepHtml += '</div>';		// closes lobby_list_hidden
		}
		
		/* Create HTML for room privacy indicator in room header */
		switch (parseInt(zinfo.privacy)) {
			case privacySEMIPRIVATE:
				privHtml = '<span>(Semi-Private Room)</span>';
				break;
			case privacyPRIVATE:
				privHtml = '<span>(Private)<img src="/images/key.png" style="height:14px;" title="This room is private" alt="(Private)" /></span>';
				break;
			default:
				privHtml = '<span>(Public Room)</span>';
				break;
		}

		roomHtml = '<div class="lobby_room">';	// Open div to start a room

		/* Create the room header */
		zvvyRoom = toZvvyJsafe(zroom);
		roomHtml +=
			'<div class="lobby_roomhead">' + 
				'<form id="enter' + zvvyRoom + '">' +
					'<button class="' + enter_button_class + '" value="enter" type="button" onclick="goByEnter(\'' + zvvyRoom + '\')">Enter</button>' +
					'<span class="lobby_roomname">' + zroom + '</span>' + 
					'<span class="lobby_roomprivacy">' + privHtml + '</span>' +
					'<div id="key' + zvvyRoom + '" class="roomkeyForm invisible">Room key: <input type="text" id="keyin' + zvvyRoom + 
					'" name="keyin' + zvvyRoom + '" size="36" maxlength="36"></div>' + 
				'</form>' +
			'</div><!-- lobby_roomhead -->';	// closes lobby_roomhead

		roomHtml +=  peepHtml + '</div><!-- lobby_room -->'	// add list of people and close the lobby_room div

		if (roomCount == 1) {
			$("#no_rooms_head").addClass("invisible");
			$(listdiv).html(roomHtml);
		} else {
			$(listdiv).append(roomHtml);	// Add the completed room to the page
		}
	}

	if (!roomCount) {		// No rooms active
		$(listdiv).html('');	// Clear the room list
		if (Cookies.username) {	// User is signed in and no rooms are active, put up suggestion to open one 
			$("#no_rooms_head").removeClass("invisible");
		}
	}
	
	/* Update page/tab title to show number of rooms open */
	if ((roomCount != Old_Room_Count) || (peepTotal != Old_Peep_Total)) {
		if (roomCount) {
			titleExt = roomCount + " room";
			if (roomCount > 1) {
				titleExt += "s";
			}
			if (peepTotal > 0) {
				titleExt += ', ' + peepTotal + " talker";
				if (peepTotal != 1) {
					titleExt += "s";
				}
			}
		} else {
			titleExt = "";
		}
		document.title = "Talkomatic: " + titleExt;
		Old_Room_Count = roomCount;
		Old_Peep_Total = peepTotal;
	}
}

/*
**	addPermRooms:
**
**	Make sure at least the Permanent Rooms always appear in the room list.
**
**	If the server doesn't have an actual room named "Hangout 247" open,
**	we artificially add it to Roomdata so it will appear as a public room.
*/

function addPermRooms () {
    var i;
    var PermRoom;
    for (i = 0; i < PermRooms.length; i++) {
        PermRoom = PermRooms[i];
        if (typeof(Roomdata[PermRoom]) === 'undefined') {
            Roomdata[PermRoom] = { "info>": {"privacy": ""} };
        }
    }
}

function serverLost () {
	document.title = "TM Server Lost";
	Old_Room_Count = 0;	
	Old_Peep_Total = 0;
	if (ServerUp) {
		ServerUp = false;
		yak ("Server stopped responding");
		yakdoc ("Server stopped responding - request sent " + timestamp(Last_Request) );
		gtag('event', 'server.stoppedrespondingOld');
	}
}

function serverFound () {
	Last_Update = Date.now();
	if (!ServerUp) {
		ServerUp = true;
		yak ("Server began responding again");
		yakdoc ("Server began responding again");
		gtag('event', 'server.resumedOld');
	}
}


/*
** 	freshRooms - Get room data from server (asynchronous). 
**
**	Call with no argument to display room list after receiving data.
**	Or call with a function name to execute that function after receiving data. 
*/
 
function freshRooms (callWhenDone) {
	var RoomRequest = new XMLHttpRequest();
	RoomRequest.open ("GET", "/roominfo.json/?key=" + toZvvyJsafe(Cookies.userPRkey), true);
	RoomRequest.onreadystatechange = function() {
		if (RoomRequest.readyState === 4 && RoomRequest.status === 200) {
			serverFound();
			// yak ("Response text: " + RoomRequest.responseText);
			Roomdata = JSON.parse(RoomRequest.responseText);
			// addPermRoom();
            addPermRooms();
			
			if (!callWhenDone) {
				list_rooms();
			} 
			else if (typeof callWhenDone == "function") {
				callWhenDone ();
			}
		}
	}
	Last_Request = new Date();
	RoomRequest.send();
}

/*
**	freshRoomsSync - synchronous version of freshRooms.
**	Browser will hang after the send, waiting for the server response.
*/
function freshRoomsSync () {
	var RoomRequest = new XMLHttpRequest();
	RoomRequest.open ("GET", "/roominfo.json/?key=" + toZvvyJsafe(Cookies.userPRkey), false);
	Last_Request =  new Date();
	RoomRequest.send();
	// yak ("Response text: " + RoomRequest.responseText);
	serverFound();
	Roomdata = JSON.parse(RoomRequest.responseText);
	// addPermRoom();
    addPermRooms();
}

/*
**	refreshRooms - Called on a timer to refresh room information 
*/
function refreshRooms () {
	if (document.forms.lobbyform.roomname.value) {
		return;	// Don't refresh if user has started typing a room name to open 
	}
	var focused = $(document.activeElement).attr("name");
	if (focused) {
		if (focused.substring(0,5) == "keyin") {
			return;	// Don't refresh if user is typing into a room's "keyin" field
		}
	}
	if ( (Date.now() - Last_Update) > Uhoh_Time) {
		serverLost();
	}
	freshRooms();
}


function showError (errcode) {
	var errmsg
	
	if (!errcode) {		// Handle undefined condition
		errcode = '';
	}
	switch (errcode) {
		case '':
			errmsg = '';	// If errcode is blank, erase any error message
			break;
			
		case 'anon':
			errmsg = $('#err_anon').html();
			break;

		case 'full':
			errmsg = $('#err_full').html();
			break;

		case 'dup':
			errmsg = $('#err_dup').html();
			break;
			
		case 'key':
			if (Cookies.userPRkey) {
				errmsg = $('#err_key_wrong').html();
			} else {
				errmsg = $('#err_key_none').html();
				// yak ("key=" + Cookies.userPRkey);
			}
			break;

		default:
			errmsg = "Error: " + errcode;
			break;
	}
	if (errmsg) {
		errmsg = "<p>" + errmsg + "</p>";
		gtag('event', 'errormessage.' + errmsg + 'Old');
	}
	$("#errormessage").html(errmsg);
	$("#errormessage").addClass("w3-large w3-margin w3-center w3-text-white w3-margins w3-container w3-border w3-border-red w3-round-xlarge");

}


/*
**	roomCheck:  Check if user is allowed to enter a room.
**
**	Pass in a room name. Return values:
**		''		(empty string) = okay to enter
**		'key'	private room, user does not have matching room key
**		'full'	room is full
**		'anon'	user does not have a name
**		'dup'	another room occupant has the same name and location
**		
**	Checks are done in this order:  key, full, anon, dup. 
**		The first problem that is found	in this sequence 
**		is the one that is returned.
**	
**	This check depends on the most recent update of Roomdata. 
**		To see if the user has the matching key for a private room, 
**		we look at the number of people in the room as reported by Roomdata. 
**
**	This will be zero if the user does not have the room key because the 
**		server suppresses the participant list in that case. 
**		The person count is Object.keys(Roomdata[roomName]).length-1. 
**		(Subtract 1 to account for the "info" item that all rooms have.) 
*/
function roomCheck (roomName) {
	var roomObj = Roomdata[roomName];
	var peeps;
	var location;
	
	if (typeof(roomObj) === 'undefined') {	// No such room - okay to open it if the user has a name
		return (Cookies.usernameClean ? '' : 'anon');
	}
	
	peeps = Object.keys(Roomdata[roomName]).length - 1;	// Count room occupants
	// yak ('roomName=' + roomName + ' #people=' + peeps);
	
	if ((roomObj[Info_Name].privacy > privacyPUBLIC) && (peeps == 0)) {	
		// Room is not public and participant list suppressed - means user does not have key.
		gtag('event', 'room.wrongkeyOld');
		return ('key');
	}
	if (peeps >= maxROOMCAPACITY) {	// Room is full
		gtag('event', 'room.fullOld');
		return ('full');
	}
	if (!Cookies.usernameClean) {	// User has no name	
		return ('anon');
	}
	
	/* Now check for duplicate name & location in the room */
	location = roomObj[Cookies.usernameClean];
	// yak("cookie name: " + Cookies.usernameClean + " cookie loc: " + Cookies.userlocClean);
	// yak("loc check type: " + typeof(location) + " value: " + location);
	if (typeof(location) !== 'undefined') {	// Undefined means no duplicate user name, so skip location check
		if (location === Cookies.userlocClean) {
			return ('dup');		// Someone in the room has the same name and same location
		}
	}

	/* No problems - okay to enter.  Set user's roomspecs cookie to match the existing room specs. */
	// yak ("Room specs: " + roomObj[Info_Name].specs);
	saveCookie("userroomspecs", roomObj[Info_Name].specs);
	return ('');	// No problems - okay to enter
}



/*
**	Send user to room indicated by the usergo cookie, for direct-to-room entrances 
*/
function gogotalk() {
	// yak("gogotalk saveCookie userroom, value from usergo: " + Cookies.usergo);
	zvvySaveCookie ("userroom", Cookies.usergo);
	saveCookie ("usergo", '');
	gotalk();
	// getCookies();	// just to get yak info
}


/*
**	Put user into a room. This is called when user types a room name on the Open Room form.
*/
function go(roomName, privacy, key, horv) {
	var canigo;
	var roomObj;
	var i;
    var cleanRoom = cleanText( roomName.trim() );
	if (!cleanRoom) {
		$.alert ( $('#openerr_noname').html() );
		return;
	}
    for (i = 0; i < PermRooms.length; i++)
    {
        if (cleanRoom == PermRooms[i]) {
            privacy = privacyPUBLIC;	// Don't let the permanent public rooms be made private
        }
    }
        if ((privacy == privacyPRIVATE) && !key) {		// specified private room but did not enter a key
		$.alert ( $('#openerr_nokey').html() );
		return;
	}
	
	/*
	**	Update room data to see if room by this name is already open 
	*/
	freshRoomsSync ()
	var roomObj = Roomdata[cleanRoom];
	
	if (typeof(roomObj) === 'undefined') {	
		/* 
		**	No such room - okay to open it and apply this user's desired room specs. 
		*/
		canigo = '';
		saveCookie("userroomspecs", horv == "v" ? "v" : "");
	}
	else {	
		/* 
		**	Room already open - check if user can enter, and if so, set user's room specs to match existing room. 
		*/
		canigo = roomCheck(cleanRoom);
		saveCookie("userroomspecs", roomObj[Info_Name].specs);
	}
	
	if (canigo == '') {	// okay to open or enter
		zvvySaveCookie("userroom", cleanRoom);
		saveCookie("privacy", privacy);
		saveUserKey(key);
		gotalk();
	}
	else {	// cannot enter existing room
		showError (canigo);
	}
}



/* 
**	goByEnter:  Handle request by user to enter an existing room.
**
**	This function can be called under three conditions:
**		1.	User initially clicks the Enter button in a room header. We let the user in if the room is public
**			or if the user already has a room key cookie that matches the room key. Otherwise, we ask user for a key.
**			
**		2.	User clicks Enter a 2nd time after submitting a key during condition 1. We save the entered key
**			in a cookie and call freshRooms, giving this function as the callback. 
**			
**		3.	Callback from freshRooms after condition 2. If the user's new key matches, the new data from 
**			freshRooms will include the room's occupant list, and we let the user into the room. Otherwise,
**			the form for entering a key remains visible so the user can try again. This condition can cycle
**			until the user successfully enters a matching key or gives up.
*/

function goByEnter(zvvyRoom) {
	var roomName;				// Decoded room name
	var canigo;				// Return code from roomCheck
	var keydiv = '#key' + zvvyRoom;		// jquery selector for div of key input form
	var keyinId = '#keyin' + zvvyRoom;	// selector for key input field
	var userPRkey;				// Key entered by user
    
    var i;
    var PermRoom;

	var callback = !zvvyRoom;		// true if this is a callback after checking user-entered key
	showError ('');				// erase any previous error message

	if (callback) {
	
		/*
		**	Room name not passed - means this is a callback from freshRooms after user submitted a key. 
		*/
		
		zvvyRoom = Cookies.userroom;
		// yak ("goByEnter room not passed. zvvyRoom=" + zvvyRoom);
		if (!zvvyRoom) {	// In case room cookie wasn't saved for some weird reason
			return;
		}
		roomName = fromZvvyCode(zvvyRoom).text;
		$(keyinId).focus();	// Focus back to key input field - prevents timer from redisplaying rooms while waiting for key
	} 
	
	else {
		/*
		**	Room name was passed, so this call was initiated by click on the Enter button for a room -
		**	either the original click, or a second click after typing a room key. The room name has	been zvvycoded.
		*/

		// yak ("goByEnter zvvyRoom passed: " + zvvyRoom);
		Cookies.userroom = zvvyRoom;
		saveCookie ("userroom", zvvyRoom);
		roomName = fromZvvyCode(zvvyRoom).text;
	}
		
	canigo = roomCheck(roomName);
	if (canigo == '') {	// good to go!
        for ( i = 0; i < PermRooms.length; i++) {
            PermRoom = PermRooms[i];
            if (roomName == PermRoom) {
                /* If entering the permanent public room, make sure it stays public and with standard room specs. */
                saveCookie("privacy", privacyPUBLIC);
                saveCookie("userroomspecs", "");
            }
        }
        gotalk();
 		return;
	}
	else if (canigo !== 'key') {
		showError (canigo);	// nope - some problem other than a room key mismatch
		freshRooms();
		return;
	}
	
	/*
	**	If we get to here, it means the room is private and the user does not have the matching key. 
	*/

	if ( $(keydiv).hasClass("invisible") ) {
		/* Form for entering room key has not been opened yet. Show it now. */
		$(keydiv).removeClass("invisible");
		$(keyinId).focus();
		return;
		/* Now the user can enter a room key. */
	}
	else {	
		/*
		**	Key form is already visible - user has clicked Enter again after (presumably) typing a key. 
		*/
		
		if (callback) {		// Show key error only if user has already typed a key that has failed
			showError (canigo);
		}
		
		$(keyinId).focus();	// Keep focus on key input field to prevent timed updates
		userPRkey = $(keyinId).val();		// Get key the user has entered
		if (!userPRkey) {
			return;		// User pressed Enter without typing anything - continue waiting.
		}
		/*
		**	$('#keyin' + zvvyRoom).val(Cookies.userPRkey);	// replace user's typing in key field
		**	$('#key' + zvvyRoom).removeClass("invisible");
		*/
		saveUserKey(userPRkey);	// save user-entered key in cookie
		// yak ("userPRkey cookie: " + Cookies.userPRkey);
		
		/*	
		**	Refresh room data (without redisplaying), 
		**	then callback this function to test the key 
		**	user has just entered. 
		*/
		freshRooms(goByEnter);
		return;
	}
}


/* Toggle visibility of lobby components. Call user_known when user name is known, user_unknown when not */

function user_known () {
	/* Hide "who are you" form */
	$("#whoareyou").addClass("invisible");

	/* Show name & location, "open new room" form, and Enter buttons on active rooms */
	$("#whoyouare").removeClass("invisible");
	$("#openroom").removeClass("invisible");
	$("button.room_enter").removeClass("invisible");
	$("input#roomname").focus();
}

function user_unknown() {
	/* Hide name & location, "open new room" form, and Enter buttons on active rooms */
	$("#whoyouare").addClass("invisible");
	$("#openroom").addClass("invisible");
	$("#no_rooms_head").addClass("invisible");
	$(".room_enter").addClass("invisible");

	/* Show "who are you" form */
	$("#whoareyou").removeClass("invisible");
	$("input#username").focus();
}


function youAre() {
	/* Show user's own name & location */
	// $("span#myname").html( " " + Cookies.usernameClean );
	$("span#myname").html( " " + unameDisplay (Cookies.usernameClean, Cookies.userauth, Cookies.userlink) );
	$("span#myloc").html( " " + Cookies.userlocClean );
	$("span#mykey").html( " " + (Cookies.userPRkey ? "********" : "(none)"));
}


/* signin - called when user clicks Sign In button on the Who Are You form */
function signin (username, userloc, userauth, userlink, signinKey) {
	username = username.trim();
	userloc = userloc ? userloc.trim() : '';	// If userloc undefined, set to blank
	yak ('signin name=' + username + ' loc=' + userloc + ' auth=' + userauth + ' link=' + userlink + ' key=' + signinKey);
	if (username !== '') {
		Cookies.username = username;
		Cookies.usernameClean = cleanText(username);
		zvvySaveCookie ("username", Cookies.username);
		zvvySaveCookie ("usernameClean", Cookies.usernameClean);

		Cookies.userloc = userloc;
		Cookies.userlocClean = cleanText(userloc);
		zvvySaveCookie ("userloc", Cookies.userloc);
		zvvySaveCookie ("userlocClean", Cookies.userlocClean);
		
		Cookies.userauth = userauth ? userauth : '';
		Cookies.userlink = userlink ? userlink : '';
		yak ('signin saving cookie: userlink=' + userlink + ' Cookies.userlink=' + Cookies.userlink);
		saveCookie ("userauth", Cookies.userauth);
		saveCookie ("userlink", Cookies.userlink);
		yak ('signin saveCookie: userlink=' + Cookies.userlink);
		
		if (signinKey) {
			Cookies.userPRkey = signinKey;
			zvvySaveCookie ("userPRkey", Cookies.userPRkey);
		}
		
		if (Cookies.usergo) {	// We're doing a go-directly-to-room signin
			gogotalk();
		}
		else {
			youAre();
			user_known();
			refreshRooms();
		}
		gtag('event', 'sign.inOld');
	}
}


/* Make the Enter key act like clicking the Sign In button */
function signinViaEnter (evt) {
	evt = (evt) ? evt : event;
	var charcode = (evt.charCode) ? evt.charCode : ((evt.which) ? evt.which : evt.keyCode);
	if (charcode == 13) {
		signin(document.forms.loginform.username.value, document.forms.loginform.userloc.value, '', '', document.forms.loginform.signinKey.value);
	}
}


/*
**	When called, this function puts the Facebook login button in the signin area of the lobby page. 
**	If the user is already logged into Facebook (has Facebook cookies) the login action occurs
**	immediately. Otherwise, the Facebook button login button appears, which the user can click
**	to manually login via Facebook. 
*/
function facebookLogin () {

	/* Load the Facebook login code */
	/*
	**	$.getScript( "/javascripts/fblogin.js" )	// did not work without leading slash
	**	  .done(function( script, textStatus ) {
	**		console.log( textStatus );
	**	  })
	**	  .fail(function( jqxhr, settings, exception ) {
	**		console.log ("FB login code failed to load");
	**	});
	*/
	var fbcode = 
		'<div id="fbbutton"><fb:login-button scope="public_profile,email" onlogin="checkFBLoginState();"></fb:login-button></div>' +
		'<div id="fblogin_status"><!-- Response from FB login appears here --></div>'
	;
	$('#fblogin_action').html(fbcode);
        gtag('event', 'fb.login.requestedOld');

}


/* signout - called when user clicks Sign Out button. Delete name and location cookies. */
function signout () {
	gtag('event', 'sign.outOld');
	document.cookie = "username=";
	document.cookie = "usernameClean=";
	document.cookie = "userloc=";
	document.cookie = "userlocClean="
	document.cookie = "userPRkey=";
	document.cookie = "userPRkeyClean=";
	document.cookie = "userauth=";
	document.cookie = "userlink=";
	Cookies.username = '';
	Cookies.usernameClean = '';
	Cookies.userloc = '';
	Cookies.userlocClean = '';
	Cookies.userPRkey = '';
	Cookies.userPRkeyClean = '';
	Cookies.userauth = '';
	Cookies.userlink = '';
	youAre();
	showError('');
	user_unknown();
}


/* changewho - called when user clicks "change" in the lobby */
function changewho () {
	showError('');
	$("#openroom").addClass("invisible");
	$('#whoareyou').removeClass('invisible');
	$("input#username").focus();
	gtag('event', 'changewhoOld');
}

function saveUserKey (userPRkey) {
	userPRkey = userPRkey ? userPRkey.trim() : '';
	Cookies.userPRkey = userPRkey;
	Cookies.userPRkeyClean = cleanText(userPRkey);
	zvvySaveCookie ("userPRkey", Cookies.userPRkey);
	zvvySaveCookie ("userPRkeyClean", Cookies.userPRkeyClean);
}

/* chooseFB - called when user clicks "Or login with Facebook" */
function chooseFB() {
	$("#fblogin_link").addClass("invisible");
	$("#fblogin_action").removeClass("invisible");
	gtag('event', 'fb.logincode.loadOld');
}


/* Document Ready jQuery function - executed when document has finished loading */
$(document).ready(function() {

	var errcode;
	var errmsg;
	var roomname;
	var rcheck;

	Cookies = getCookies();

	if (!Cookies.username) {		// Avoid displaying "undefined"
		Cookies.username = '';
		Cookies.usernameClean = '';
	}
	if (!Cookies.userloc) {
		Cookies.userloc = '';
		Cookies.userlocClean = '';
	}
	if (!Cookies.userauth) {
		Cookies.userauth = '';
	}
	if (!Cookies.userlink) {
		Cookies.userlink = '';
	}
	
	if (!Cookies.userPRkey) {
		Cookies.userPRkey = '';
		Cookies.userPRkeyClean = '';
	}

	if (!Cookies.userroom) {
		Cookies.userroom = '';
	}
	
	if (!Cookies.userroomspecs) {
		Cookies.userroomspecs = '';
	}

	/* If user doesn't have a userid cookie, create one now. */
	if (!Cookies.userid) {
		newUserId();
	}

	/* Plug user name & location into signin form and "you are" area, if known */
	document.forms.loginform.username.value = Cookies.username ? Cookies.username : '';
	document.forms.loginform.userloc.value = Cookies.userloc ? Cookies.userloc : '';
	document.forms.loginform.signinKey.value = '';
	youAre();
	
	/* In Open Room form, default to public, and plug room key into form if user has entered one. */
	$('input:radio[name="privacy"][id="priv-public"]').prop('checked', true);
	$("#roomkey").addClass("invisible").val(Cookies.userPRkey); 

	/* In Open Room form, show room key field only when "private" button is checked. */
	$("input:radio[name=privacy]").click(function() {
		if ( parseInt( $(this).val() ) == privacyPRIVATE ) {
			$("#roomkey, #keylabel").removeClass("invisible");
			$("#roomkey").focus();
		} else {
			$("#roomkey, #keylabel").addClass("invisible");
		}
	});
	
	/* In Open Room form, check radio button for vertical or horizontal depending on user's cookie. Default is horizontal. */
	if (Cookies.userroomspecs == "v") {
		$("#horv-v").prop("checked", true);
	} else {
		$("#horv-h").prop("checked", true);
	}
	
	/* Handle go-directly-to-room entrance */
	if (Cookies.usergo) {
		// yak("usergo=" + Cookies.usergo + " username=" + Cookies.username);
		roomname = Cookies.usergo;
		freshRoomsSync();		// Get room data, don't continue until we have it

		rcheck = roomCheck(roomname);	// Check if user will be allowed into the room
		// yak ("rcheck=" + rcheck);
		if (rcheck == '') {		// No problems - GO!
			gogotalk();
			return;
		}
	
		/* Could not immediately enter room, so do what needs to be done depending on the reason. */

		/* Plug destination room name into header of signin form */
		$("#whoareyou").css( {width: '80%'} );	// Widen the signin form to give more space for long room names 
		$("#who_goroom").html(roomname).removeClass("invisible");
		$("#skipgo").removeClass("invisible");
		
		switch (rcheck) {
		
			case 'anon':	// User does not have a name - show signin form
				$("#whoareyou").removeClass("invisible");
				$("input#username").focus();
				break;
			
			case 'dup':		// User is duplicate - show error and signin form
				showError (rcheck);
				$("#whoareyou").removeClass("invisible");
				$("input#username").focus();
				break;
				
			case 'key':		// User does not have the room key - show signin form with key field
				showError (rcheck);
				$("#whoareyou").removeClass("invisible");
				$("input#signinKey").css( {display: 'block'} );
				if (Cookies.username) {
					$("input#signinKey").focus();
				} else {
					$("input#username").focus();
				}
				break;
				
			case 'full':	// Room is full, or...
			default:		// any unforeseen error - show error. No signin because user already has a name.
				showError (rcheck);
		}
	} else  {	// Normal entry to lobby, either first entry to the site or exiting from a room.

		/* Errors are passed to the lobby by appending # and an error code to the URL. */
		errcode = document.URL.split('#')[1];
		showError (errcode);
		
		
		/* Display the Open Room form if username is known, or signin form if not */
		if (Cookies.username) {
			user_known();
		}
		else {
			user_unknown();
		}
	}
	
	/* Display active rooms */
	freshRooms();

	if (Update_Time > 0) {
		TimerFunc = setInterval(refreshRooms, Update_Time); // Refresh room display every few seconds
	}

})	// End of document ready function