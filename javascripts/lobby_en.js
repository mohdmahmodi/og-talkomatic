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
*/
/*global
	$, yak, yakdoc, toZvvyJsafe, gtag, timestamp, delCookie, getCookies, newUserId,
	saveCookie, zvvySaveCookie, saveCookie, gotalk, cleanText, fromZvvyCode, unameDisplay 
	window, jQuery,
	Audio, clearInterval, clearTimeout, document, event, history, Image, location, name, navigator, Option, screen, setInterval, setTimeout, XMLHttpRequest
*/

/*jslint
	maxerr:500,
	indent:false,
	white:true
*/

/*jshint 
	latedef:nofunc
*/




var glbCookies		= {		// Global - Cookie values
	username: '',
	usernameClean: '',
	userloc: '',
	userlocClean: '',
	userauth: '',			//	3rd party authenticator, e.g. Facebook
	userlink: '',			//	Link to user's 3rd party profile
	userid: '',
	userPRkey: '',			//	Key for Private Room (temporarily persisted)
	userSPRkey: '',			//	key for Semi-Private Room (temporarily persisted)
	userPRkeyClean: '',
	userSPRkeyClean: '',
	userroom: '',
	userroomspecs: '',
	usergo: '',
	privacy: 0
};

var glbRoomdata;					//	Global - gets filled with room data by request to server.
var glbTimerFunc;					//	Global - timer function to refresh room data

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

var Update_Time		= 4000;			//	How often to auto-update lobby display, 
									//	in milliseconds. 0 for no auto-updates. Normally 4000.
var Last_Request;					//	Time when request to server was most recently issued
var Uhoh_Time		= 20000;		//	Issue "server down" alert after this much 
									//	time without a response from the server 
var Last_Update		= Date.now();	//	Time when response from server was most recently received
var ServerUp		= true;			//	True if server is responding to requests






//	Catch unloads so we can gracefully exit the system
//	from the SERVER'S perspective
//	We have to be careful with this so we don't kill the 
//	context as we move about the system

//	$(window).on("unload", signOut);

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

/*
**	Define "prop" function in case the current 
**	jQuery version does not support it.
**	This code found at http://stackoverflow.com/questions/6323431/jquery-prop-compatibility
*/
(function($){
	"use strict";
    if (typeof($.fn.prop) !== 'function') {
    $.fn.prop = function(name, value){
        if (typeof(value) === 'undefined') {
            return (this.attr(name));
        } else {
            return this.attr(name, value);
        }
    };
	}
})(jQuery);

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
		width: "70%",
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

	gtag('event', 'openroom.questionmark');

}

/*
**	CALLED FROM HTML
**	Inhibit the response to the Enter key
**		This function is invoked on each keypress and is only called
**		by the "Key" Input box to determine when to enter the room.
*/
function roomKeyEnter(event){
	var key = (event.keyCode || event.which);
	if (event.which == 13) {
		event.preventDefault();
		key = key;
		goByEnter((event.target.name).substr(5));
		}
}

/*
**	list_rooms: 
**		Generate contents of the "chooseroom" div showing all active rooms and participants 
*/
function list_rooms() {

	var listdiv = $("div#roomlist")[0];	// Get a handle on the roomlist div
	var zroom;							//	room name
	var zvvyRoom;						//	zvvyCoded room name
	var zpeep;							//	person name
	var zloc;							//	person location
	var zinfo;							//	room information object (privacy setting, perhaps others)
	var privHtml;						//	HTML indicating room privacy
	var roomHtml;						//	used to build the HTML to display a room and its occupants
	var roomsHtml;						//	used to build the HTML to display all rooms
	var peepHtml;						//	used to build HTML for people list
	var roomCount;						//	number of rooms open
	var peepCount;						//	number of people in a room
	var peepTotal;						//	total of people in all rooms
	var titleExt;						//	extension to add on to page title
	var buttonColor;					//	Changes Color depending on whether or not we have key
	//	var active;

	var enter_button_class = "room_enter";
	if (!glbCookies.username) {
		enter_button_class += " invisible";	// Make Enter buttons invisible if username is unknown
	}

	/* Loop through the rooms. */
	roomCount = 0;
	peepTotal = 0;

	roomsHtml = '';
	
	for (zroom in glbRoomdata) {
		/* zroom is now a room name (cleaned but not zvvyCoded). */

		roomCount++;
		
		buttonColor = 'w3-black';
		
		if ( parseInt(glbRoomdata[zroom][Info_Name].privacy) === privacySEMIPRIVATE ) {
			buttonColor = (glbRoomdata[zroom][Info_Name].currentKey === '' ? 'w3-black' : 'w3-green');
		}

		/*	
		**	Create the HTML list of people in the room. 
		**	In the process we pick up room settings from 
		**	the "info>" pseudo-person in the room data. 
		*/
		peepCount = 0;
		peepHtml = '<div id="peopleInRoom' + roomCount + '" class="w3-black">';
		
		for (zpeep in glbRoomdata[zroom]) {

			// yak("zpeep=" + zpeep);
			// yak("loc=" + glbRoomdata[zroom][zpeep]);
			
			if (zpeep === Info_Name) {
				zinfo = glbRoomdata[zroom][Info_Name];		// Get room settings
				// yak ("Room specs: " + zinfo.specs);
			} else {
				peepCount++;
				// DINGBAT CIRCLED SANS-SERIF DIGIT ONE = 10112
				// DINGBAT NEGATIVE CIRCLED SANS-SERIF DIGIT ONE = 10122
				// Dingbat Negative Circled Digit One = 10102
				zloc = glbRoomdata[zroom][zpeep];
				peepHtml +=
					'<div class="w3-black w3-text-orange w3-margin-left">' +
					'<i class="fa fa-comments-o">&nbsp;</i>' +
					'&#' + ((peepCount - 1) + 10112) + '&nbsp;' + zpeep  +
					'&nbsp;/&nbsp;' + ( (zloc === '') ? '<i class="w3-text-yellow" >On The Web</i>' : zloc) +  // 
					'</div>';	// closes lobby_person
			}
		}
		peepHtml += '</div><!-- peopleInRoom' + roomCount + '-->';
		peepTotal += peepCount;
		
		// yak ("peepCount=" + peepCount);
		if (peepCount === 0) {	
			peepHtml = '<div class="w3-black w3-text-orange w3-center">';
			if ( zinfo.privacy == privacyPRIVATE ) {	// private room
				peepHtml += '&nbsp;<i class=" w3-margin-right fa fa-eye-slash "></i>&nbsp;';
				peepHtml += $('#peep_hidden').html();
				peepHtml += '&nbsp;<i class="  fa fa-eye-slash w3-margin-left"></i>&nbsp;';
			} else {					// public room
				peepHtml += '&nbsp;<i class="w3-margin-right fa fa-child"></i>&nbsp;';
				peepHtml += $('#peep_empty').html();
				peepHtml += '&nbsp;<i class=" fa fa-child w3-margin-left"></i>&nbsp;';
			}
			peepHtml += '</div>';		// closes lobby_list_hidden
		}
		
		/* Create HTML for room privacy indicator in room header */
		switch (parseInt(zinfo.privacy)) {
			case privacySEMIPRIVATE:
				privHtml = '<span class="w3-small w3-text-aqua">(Semi-Private Room)<i class="w3-margin-left fa fa-low-vision"></i></span>';
				break;
			case privacyPRIVATE:
				privHtml = '<span class="w3-small  w3-text-aqua">(Private)<i class="w3-margin-left fa fa-key"></i></span>';
				break;
			default:
				privHtml = '<span class="w3-small  w3-text-aqua">(Public Room)<i class="w3-margin-left fa fa-handshake-o"></i></span>';
				break;
		}

		roomHtml = '';	
		/* 
		**	Create the room header
		*/
		zvvyRoom = toZvvyJsafe(zroom);
		
		roomHtml +=
			'<div id="lobby_room_' + roomCount + '" ' +
				'class="lobby_room w3-padding-small w3-border-top w3-border-white w3-black w3-text-white w3-display-container">' + 
				zroom +  "&nbsp;" + 
				( peepCount === 0 ? "" : ( peepCount == 1 ? "(1 Person)" : "(" + peepCount + " People)" ) ) +
				'<form id="enter' + zvvyRoom + '" name="' + zvvyRoom + '">' +
					'<button class="' + enter_button_class + 
						' w3-small w3-margin w3-display-topright w3-button ' + buttonColor + 
						' w3-border w3-border-orange w3-round" value="enter" type="button" onclick="goByEnter(\'' + 
						zvvyRoom + '\')">Enter...&nbsp;<i class="fa fa-comments-o"></i></button>' + 
					'<span class="lobby_roomprivacy">' + privHtml + '</span>' +
					'<div id="key' + zvvyRoom + 
						'" class="roomkeyForm invisible w3-container w3-input"><span>Key Please?</span><span class="w3-text-yellow w3-margin-left">(36 Character Limit)</span><input style="width:15em" type="text" class="w3-input" id="keyin' + zvvyRoom + 
						'" name="keyin' + zvvyRoom + '" size="36" maxlength="36" onkeydown="roomKeyEnter(event)"></span></div>' + 
				'</form>' +
			'</div><!-- lobby_room -->';

		roomHtml += peepHtml;
		
		roomsHtml += roomHtml;
		
		if (roomCount == 1) {
			$("#no_rooms_head").addClass("invisible");
		}
	}
	$("input.roomkeyForm").keyup(function(event) {
		if (event.keyCode === 13) {
			$("#myButton").click();
		}
	});

	
	$(listdiv).html(roomsHtml);

	if (!roomCount) {			//	No rooms active
		$(listdiv).html('');	//	Clear the room list
		if (glbCookies.username) {	//	User is signed in and no rooms are 
								//		active, put up suggestion to open one 
			$("#no_rooms_head").removeClass("invisible");
		}
	}
	
	/*
	**	Update page/tab title to show number of rooms open 
	*/
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
**	we artificially add it to glbRoomdata so it will appear as a public room.
*/

function addPermRooms () {
    var i;
    var PermRoom;
    for (i = 0; i < PermRooms.length; i++) {
        PermRoom = PermRooms[i];
        if (typeof(glbRoomdata[PermRoom]) === 'undefined') {
            glbRoomdata[PermRoom] = { "info>": {"privacy": ""} };
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
		gtag('event', 'server.stoppedresponding');
	}
}

function serverFound () {
	Last_Update = Date.now();
	if (!ServerUp) {
		ServerUp = true;
		yak ("Server began responding again");
		yakdoc ("Server began responding again");
		gtag('event', 'server.resumed');
	}
}


/*
** 	freshRooms - Get room data from server (asynchronous). 
**
**	Call with no argument to display room list after receiving data.
**	Or call with a function name to execute that function after receiving data. 
*/
 
function constructParms () {
	var addParms	= '';

	glbCookies = getCookies();
	
	if ( glbCookies.usernameClean !== '' ) {
		addParms += '&unc=' + toZvvyJsafe(glbCookies.usernameClean);
	}
	if ( glbCookies.userlocClean !== '' ) {
		addParms += '&ulc=' + toZvvyJsafe(glbCookies.userlocClean);
	}
	if ( glbCookies.userPRkey !== '' && glbCookies.privacy == privacyPRIVATE ) {
		addParms += '&key=' + toZvvyJsafe(glbCookies.userPRkey);
	}
	if ( glbCookies.userPRkey !== '' && glbCookies.privacy == privacySEMIPRIVATE ) {
		addParms += '&SPRkey=' + toZvvyJsafe(glbCookies.userSPRkey);
	}
	if (typeof(glbCookies.requestRoom) !== 'undefined' && glbCookies.requestRoom !== '') {
		// The cookie is already Zvvy coded
		addParms += '&reqRoom=' + toZvvyJsafe(glbCookies.requestRoom);
	}
	return ( addParms === '' ? '' : '?' + addParms);	
}
	
function freshRooms (callWhenDone) {

	var RoomRequest = new XMLHttpRequest();
	var parms = constructParms();
	
	console.log(parms);
	
	RoomRequest.open ("GET", "/roominfo.json/" + parms, true);
	RoomRequest.onreadystatechange = function () {
	if (RoomRequest.readyState === 4 && RoomRequest.status === 200) {
		serverFound();
		// yak ("Response text: " + RoomRequest.responseText);
		glbRoomdata = JSON.parse(RoomRequest.responseText);
           addPermRooms();
		
		if (!callWhenDone) {
			list_rooms();
		} 
		else if (typeof callWhenDone == "function") {
			callWhenDone ();
		}
	}
	};
	Last_Request = new Date();
	RoomRequest.send();

	if (typeof(glbCookies.requestRoom) !== 'undefined' && glbCookies.requestRoom !== '') {
		$.alert ( $('#okrequested').html() );
		delCookie('requestRoom');
	}
}

/*
**	freshRoomsSync - synchronous version of freshRooms.
**	Browser will hang after the send, waiting for the server response.
*/
function freshRoomsSync () {
	var RoomRequest = new XMLHttpRequest();
	var parms = constructParms();
	RoomRequest.open ("GET", "/roominfo.json/" + parms, false);
	Last_Request =  new Date();
	RoomRequest.send();
	// yak ("Response text: " + RoomRequest.responseText);
	serverFound();
	glbRoomdata = JSON.parse(RoomRequest.responseText);
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
	var errmsg;
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

//		case 'wait':
//			errmsg = $('#err_wait').html();
//			break;
			
		case 'key':
			if (glbCookies.userPRkey) {
				errmsg = $('#err_key_wrong').html();
			} else {
				errmsg = $('#err_key_none').html();
				// yak ("key=" + glbCookies.userPRkey);
			}
			break;

		default:
			errmsg = "Error: " + errcode;
			break;
	}
	if (errmsg) {
		gtag('event', 'errormessage.' + errmsg);
		$("#errormessage").html(errmsg);
		$("#errormessage").addClass("w3-normal w3-margin w3-center w3-text-white w3-margins w3-container w3-border w3-border-red w3-round-xlarge");
	} else {
		$("#errormessage").html('');
		$("#errormessage").removeClass("w3-normal w3-margin w3-center w3-text-white w3-margins w3-container w3-border w3-border-red w3-round-xlarge");		
	}
}


/*
**	roomCheck:  Check if user is allowed to enter a room.
**
**	Pass in a room name. Return values:
**		''		(empty string) = okay to enter
**		'key'	private room, user does not have matching room key
**		'full'	room is full
**		'anon'	user does not have a name
**		'wait'	user's request was not granted ... yet.
**		'dup'	another room occupant has the same name and location
**		
**	Checks are done in this order:  key, wait, full, anon, dup. 
**		The first problem that is found	in this sequence 
**		is the one that is returned.
**
**	Logic for Private and Semi-private Rooms:
**	
**	This check depends on the most recent update of glbRoomdata. 
**		To see if the user has the matching key for a private room,
**
**	For PRIVATE Rooms,
**
**		we look at the number of people in the room as reported by glbRoomdata.
**		This will be zero if the user does not have the room key because the 
**			server suppresses the participant list in that case. 
**			The person count is Object.keys(glbRoomdata[roomName]).length-1. 
**		(Subtract 1 to account for the "info" item that all rooms have.) 
**
**	For SEMIPRIVATE Rooms,
**
**		we check to see if the key was passed in the roomdata.
**		if the key was passed, the host said it was okay for us to
**		enter.  But for private rooms, we don't save the key and
**		treat it as completely volatile.
**
**		glbRoomdata[roomName][Info_Name].currentKey
**
**	TODO: Logic for Semi-private rooms:
**
*/

function roomCheck (roomName) {
	var roomObj = glbRoomdata[roomName];
	var peeps;
	var currentKey;
	var userLocn;
	var userName;
	
	if (typeof(roomObj) === 'undefined') {	// No such room - okay to open it if the user has a name
		return (glbCookies.usernameClean ? 'okay' : 'anon');
	}
	
	peeps = Object.keys(glbRoomdata[roomName]).length - 1;	// Count room occupants
	// yak ('roomName=' + roomName + ' #people=' + peeps);

	
	if ((roomObj[Info_Name].privacy == privacyPRIVATE) && (peeps === 0)) {	
		//	Room is private and participant list suppressed - 
		//	means user does not have correct key.
		gtag('event', 'room.wrongkey');
		return ('key');
	}
	
	if ( (roomObj[Info_Name].privacy == privacySEMIPRIVATE) ) {	
		currentKey = (roomObj[Info_Name].currentKey);
		currentKey = (typeof(currentKey) === 'undefined' ? '' : currentKey);
		if ( currentKey === '' ) {
			gtag('event', 'room.wrongkey');
			return('key');
		} else {
			saveCookie("privacy", privacySEMIPRIVATE);
			saveUserSPRKey(currentKey);
		}
		//	Server response gets processed before anything else
		reqResp = roomObj[Info_Name].reqResp;
		switch (reqResp) {
			case 'duplicate':	{
				return 'dup';
			}
			case 'waiting':		{
				return 'wait';
			}
			case 'overlimit':	{
				return 'full';
			}
			case 'added':		{
				return 'wait';
			}
			default:			{
				break;
			}
		}	
	}

	if (peeps >= maxROOMCAPACITY) {	// Room is full
		gtag('event', 'room.full');
		return ('full');
	}
	if (!glbCookies.usernameClean) {	// User has no name	
		return ('anon');
	}
	
	/* Now check for duplicate name & location in the room */
	userName = roomObj[glbCookies.usernameClean];
	// yak("cookie name: " + glbCookies.usernameClean + " cookie loc: " + glbCookies.userlocClean);
	// yak("loc check type: " + typeof(userLocn) + " value: " + userLocn);
	if (userName !== undefined) {	// Undefined means no duplicate user name, so skip location check
		if (userName === glbCookies.userlocClean) {
			return ('dup');		// Someone in the room has the same name and same location
		}
	}

	/* No problems - okay to enter.  Set user's roomspecs cookie to match the existing room specs. */
	// yak ("Room specs: " + roomObj[Info_Name].specs);
	
	saveCookie("privacy", roomObj[Info_Name].privacy);
	saveCookie("userroomspecs", roomObj[Info_Name].specs);
	return ('okay');	// No problems - okay to enter
}



/*
**	Send user to room indicated by the usergo cookie, for direct-to-room entrances 
*/
function gogotalk() {
	// yak("gogotalk saveCookie userroom, value from usergo: " + glbCookies.usergo);
	zvvySaveCookie ("userroom", glbCookies.usergo);
	saveCookie ("usergo", '');
	gotalk();
	// getCookies();	// just to get yak info
}


/*
**	CALLED FROM HTML
**	Put user into a room. This is called when user types a room name on the Open Room form.
*/
function go(roomName, privacy, key, horv) {
	
	var canigo;
	var roomObj;
	var i;
    var cleanRoom = cleanText( roomName.trim() );
	var reqResp;
	
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
	
	if ((privacy == privacyPRIVATE) && !key) 
	{	//	specified private room but did not enter a key
		$.alert ( $('#openerr_nokey').html() );
		return;
	}
	
	/*
	**	Update room data to see if room by this name is already open 
	*/
	freshRoomsSync ();
	roomObj = glbRoomdata[cleanRoom];

	
	if (typeof(roomObj) === 'undefined') {	
		/* 
		**	No such room - okay to open it and apply this user's desired room specs. 
		*/
		canigo = 'okay';
		saveCookie("userroomspecs", horv == "v" ? "v" : "");
	}
	else {	
		/* 
		**	Room already open - check if user can enter, and if so, set user's room specs to match existing room. 
		*/
		canigo = roomCheck(cleanRoom);
		saveCookie("userroomspecs", roomObj[Info_Name].specs);
	}
	
	if (canigo == 'okay') {	// okay to open or enter
		zvvySaveCookie("userroom", cleanRoom);
		saveCookie("privacy", privacy);
		if ( privacy == privacyPRIVATE) {
			saveUserPRKey(key);
		} else if ( privacy == privacySEMIPRIVATE ) {

			roomObj = glbRoomdata[roomName];
			if (typeof(roomObj) !== 'undefined') { // Only if the room exists
				var currentKey = (roomObj[Info_Name].currentKey);
				if ( currentKey !== '' ) {
					saveUserSPRKey(currentKey);
				}
			}
			
		} else {
			saveUserPRKey('');
			saveUserSPRKey('');
		}
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
**		1.	User initially clicks the Enter button in a room header. 
**			We let the user in if the room is public
**			or if the user already has a room key cookie 
**			that matches the room key. Otherwise, we ask user for a key.
**			
**		2.	User clicks Enter a 2nd time after submitting a key 
**			during condition 1. We save the entered key
**			in a cookie and call freshRooms, giving this
**			function as the callback. 
**			
**		3.	Callback from freshRooms after condition 2. If the 
**			user's new key matches, the new data from 
**			freshRooms will include the room's occupant list, 
**			and we let the user into the room. Otherwise,
**			the form for entering a key remains visible so 
**			the user can try again. This condition can cycle
**			until the user successfully enters a matching key 
**			or gives up.
*/

function goByEnter(zvvyRoom) {
	var roomName;		//	Decoded room name
	var canigo;			//	Return code from roomCheck
	var userPRkey;		//	Key entered by user
	var zinfo;			//	Room Information

	var keydiv	= '#key' + zvvyRoom;	//	jquery selector for div of key input form
	var keyinId	= '#keyin' + zvvyRoom;	//	selector for key input field
    
    var i;
    var PermRoom;

	var callback = !zvvyRoom;	//	true if this is a callback after checking user-entered key
	showError ('');				//	erase any previous error message

	if (callback) {
	
		/*
		**	Room name not passed - means this is a callback from freshRooms after user submitted a key. 
		*/
		
		zvvyRoom = glbCookies.userroom;
		yak ("goByEnter room not passed. zvvyRoom=" + zvvyRoom);
		if (!zvvyRoom) {	// In case room cookie wasn't saved for some weird reason
			return;
		}
		roomName = fromZvvyCode(zvvyRoom).text;
		$(keyinId).focus();	// Focus back to key input field - prevents timer from redisplaying rooms while waiting for key
	} 
	
	else {
		/*
		**	Room name was passed, so this call was initiated by 
		**	click on the Enter button for a room -
		**	either the original click, or a second click after 
		**	typing a room key. The room name has been zvvycoded.
		*/

		yak ("goByEnter zvvyRoom passed: " + zvvyRoom);
		glbCookies.userroom = zvvyRoom;
		saveCookie ("userroom", zvvyRoom);
		roomName = fromZvvyCode(zvvyRoom).text;
	}
		
	canigo = roomCheck(roomName);
	zinfo = glbRoomdata[roomName][Info_Name];
	
	switch (canigo) {
		
		case 'okay': { // good to go!	
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
		
		case 'key': {
	
			/*
			**	If we get to here, it means the room is private or semi-private 
			**		and the user does not have the matching key. 
			*/
			
			if ( zinfo.privacy == privacyPRIVATE ) {

				/*
				**	The key form needs to be displayed for Private rooms
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
					**	Key form is already visible - 
					**		user has clicked Enter again after (presumably) typing a key. 
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
					**	$('#keyin' + zvvyRoom).val(glbCookies.userPRkey);	// replace user's typing in key field
					**	$('#key' + zvvyRoom).removeClass("invisible");
					*/
					saveCookie("privacy", privacyPRIVATE);
					saveUserPRKey(userPRkey);	// save user-entered key in cookie
					yak ("userPRkey cookie: " + glbCookies.userPRkey);
					
					/*	
					**	Refresh room data (without redisplaying), 
					**	then callback this function to test the key 
					**	user has just entered. 
					*/
					freshRooms(goByEnter);
					return;
				}
			}

			if ( zinfo.privacy == privacySEMIPRIVATE ) {
				/*
				**	The user is asking for access to a semiprivate room
				**		so we save it for processing when we get the room data
				*/
				glbCookies.requestRoom = glbCookies.userroom;
				saveCookie('requestRoom', glbCookies.userroom);
			}
			return;
		}
		
		default: {
			showError (canigo);	// nope - some problem other than a room key mismatch
			freshRooms();
			return;
		}
	}

}


/*
**	Toggle visibility of lobby components. 
**	Call user_known when user name is known, 
**	user_unknown when not */

function user_known () {
	/* Hide "who are you" form */
	$("#whoareyou").addClass("invisible");

	/*
	**	Show name & location, 
	**	"open new room" form, 
	**	and Enter buttons on active rooms 
	*/
	$("#loginfirst").addClass("invisible");
	$("#whoyouare").removeClass("invisible");
	$("#openroom").removeClass("invisible");
	$("button.room_enter").removeClass("invisible");
	$("input#roomname").focus();
}

function user_unknown() {
	/*
	**	Hide name & location, 
	**	"open new room" form, 
	**	and Enter buttons on active rooms 
	*/
	$("#loginfirst").removeClass("invisible");
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
	$("span#myname").html( " " + unameDisplay (glbCookies.usernameClean, glbCookies.userauth, glbCookies.userlink) );
	$("span#myloc").html( " " + glbCookies.userlocClean );
	$("span#mykey").html( " " + (glbCookies.userPRkey ? "********" : "(none)"));
}


/*
**	signin
**		called when user clicks Sign In button on the Who Are You form 
*/
function signin (username, userloc, userauth, userlink, signinKey) {

	username = username.trim();
	userloc = userloc ? userloc.trim() : '';	// If userloc undefined, set to blank
	yak ('signin name=' + username + ' loc=' + userloc + ' auth=' + userauth + ' link=' + userlink + ' key=' + signinKey);
	if (username === '') {
		$.alert( $("#err_anon").html() , "Forget Something?");
	} else {
		
		$("#changewho").removeClass("invisible");
		$("#openroom").removeClass("invisible");
		$("#signin").addClass("invisible");

		glbCookies.username = username;
		glbCookies.usernameClean = cleanText(username);
		zvvySaveCookie ("username", glbCookies.username);
		zvvySaveCookie ("usernameClean", glbCookies.usernameClean);

		glbCookies.userloc = userloc;
		glbCookies.userlocClean = cleanText(userloc);
		zvvySaveCookie ("userloc", glbCookies.userloc);
		zvvySaveCookie ("userlocClean", glbCookies.userlocClean);
		
		glbCookies.userauth = userauth ? userauth : '';
		glbCookies.userlink = userlink ? userlink : '';
		yak ('signin saving cookie: userlink=' + userlink + ' glbCookies.userlink=' + glbCookies.userlink);
		saveCookie ("userauth", glbCookies.userauth);
		saveCookie ("userlink", glbCookies.userlink);
		yak ('signin saveCookie: userlink=' + glbCookies.userlink);
		
		if (signinKey) {
			glbCookies.userPRkey = signinKey;
			zvvySaveCookie ("userPRkey", glbCookies.userPRkey);
		}
		
		if (glbCookies.usergo) {	// We're doing a go-directly-to-room signin
			gogotalk();
		}
		else {
			youAre();
			user_known();
			refreshRooms();
		}
		gtag('event', 'sign.in');
	}
}


/*
**	CALLED FROM HTML
**	Make the Enter key act like clicking the Sign In button 
*/
function signinViaEnter (evt) {
	evt = (evt) ? evt : event;
	var charcode = (evt.charCode) ? evt.charCode : ((evt.which) ? evt.which : evt.keyCode);
	if (charcode == 13) {
		signin(document.forms.loginform.username.value, document.forms.loginform.userloc.value, '', '', document.forms.loginform.signinKey.value);
	}
}


/*
**	CALLED FROM HTML
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
		'<div id="fbbutton">' +
		'<fb:login-button scope="public_profile,email" onlogin="checkFBLoginState();">' +
		'</fb:login-button></div>' +
		'<div id="fblogin_status">' +
		'<!-- Response from FB login appears here -->' +
		'</div>';
		
	$('#fblogin_action').html(fbcode);
        gtag('event', 'fb.login.requested');

}
/*
**	Document Ready (constructor) Function
*/
function docConstructor () {

	var errcode;
	var roomname;
	var rcheck;

	glbCookies = getCookies();

	if (!glbCookies.username) {		// Avoid displaying "undefined"
		glbCookies.username = '';
		glbCookies.usernameClean = '';
	}
	if (!glbCookies.userloc) {
		glbCookies.userloc = '';
		glbCookies.userlocClean = '';
	}
	if (!glbCookies.userauth) {
		glbCookies.userauth = '';
	}
	if (!glbCookies.userlink) {
		glbCookies.userlink = '';
	}
	
	if (!glbCookies.userPRkey) {
		glbCookies.userPRkey = '';
		glbCookies.userPRkeyClean = '';
	}

	if (!glbCookies.userSPRkey) {
		glbCookies.userSPRkey = '';
		glbCookies.userSPRkeyClean = '';
	}

	if (!glbCookies.userroom) {
		glbCookies.userroom = '';
	}
	
	if (!glbCookies.userroomspecs) {
		glbCookies.userroomspecs = '';
	}
	
	if (!glbCookies.usergo) {
		glbCookies.usergo = '';
	}
	
	if (!glbCookies.privacy) {
		glbCookies.privacy = 0;
	}
	
	/*
	**	Non-Volatile - Not cleared at logout
	**	If user doesn't have a userid cookie, create one now. 
	*/
	if (!glbCookies.userid) {
		newUserId();
	}

	/* Plug user name & location into signin form and "you are" area, if known */
	document.forms.loginform.username.value = glbCookies.username ? glbCookies.username : '';
	document.forms.loginform.userloc.value = glbCookies.userloc ? glbCookies.userloc : '';
	document.forms.loginform.signinKey.value = '';
	youAre();
	
	/* In Open Room form, default to public, and plug room key into form if user has entered one. */
	$('input:radio[name="privacy"][id="priv-public"]').prop('checked', true);
	$("#roomkey").addClass("invisible").val(glbCookies.userPRkey); 

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
	if (glbCookies.userroomspecs == "v") {
		$("#horv-v").prop("checked", true);
	} else {
		$("#horv-h").prop("checked", true);
	}
	
	/* Handle go-directly-to-room entrance */
	if (glbCookies.usergo) {
		// yak("usergo=" + glbCookies.usergo + " username=" + glbCookies.username);
		roomname = glbCookies.usergo;
		freshRoomsSync();		// Get room data, don't continue until we have it

		rcheck = roomCheck(roomname);	// Check if user will be allowed into the room
		// yak ("rcheck=" + rcheck);
		if (rcheck == 'okay') {		// No problems - GO!
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
				if (glbCookies.username) {
					$("input#signinKey").focus();
				} else {
					$("input#username").focus();
				}
				break;
				
			default:	// Room is full, or...
						// any unforeseen error - show error. No signin because user already has a name.
				showError (rcheck);
		}
	} else  {	// Normal entry to lobby, either first entry to the site or exiting from a room.

		/* Errors are passed to the lobby by appending # and an error code to the URL. */
		errcode = document.URL.split('#')[1];
		showError (errcode);
		
		
		/* Display the Open Room form if username is known, or signin form if not */
		if (glbCookies.username) {
			user_known();
		}
		else {
			user_unknown();
		}
	}
	
	/* Display active rooms */
	freshRooms();

	if (Update_Time > 0) {
		glbTimerFunc = setInterval(refreshRooms, Update_Time); // Refresh room display every few seconds
	}
	
}
/*
**	CALLED FROM HTML
**	signOut
**		called when user clicks Sign Out button. Delete name and location cookies. 
*/
function signOut () {

	gtag('event', 'sign.out');
	
	$("#changewho").addClass("invisible");
	$("#signout").addClass("invisible");
	$("#signin").removeClass("invisible");
	$("#username").val('');
	$("#userloc").val('');
	
	
	document.cookie = "username=";
	document.cookie = "usernameClean=";
	document.cookie = "userloc=";
	document.cookie = "userlocClean=";
	document.cookie = "userPRkey=";
	document.cookie = "userSPRkey=";
	document.cookie = "userPRkeyClean=";
	document.cookie = "userSPRkeyClean=";
	document.cookie = "userauth=";
	document.cookie = "userlink=";
	document.cookie = "userroom=";
	document.cookie = "userroomspecs=";
	document.cookie = "usergo=";
	
	glbCookies.username = '';
	glbCookies.usernameClean = '';
	glbCookies.userloc = '';
	glbCookies.userlocClean = '';
	glbCookies.userPRkey = '';
	glbCookies.userSPRkey = '';
	glbCookies.userPRkeyClean = '';
	glbCookies.userSPRkeyClean = '';
	glbCookies.userauth = '';
	glbCookies.userlink = '';
	glbCookies.userroom = '';
	glbCookies.userroomspecs = '';
	glbCookies.usergo = '';

	delCookie('privacy');

	youAre();
	showError('');
	user_unknown();
}


/*
**	CALLED FROM HTML
**	changewho
**		called when user clicks "change" in the lobby 
*/
function changewho () {
	showError('');
	$("#changewho").addClass("invisible");
	$("#openroom").addClass("invisible");
	$("#signin").removeClass("invisible");
	
	$('#whoareyou').removeClass('invisible');
	$("input#username").focus();
	gtag('event', 'changewho');
}

function saveUserPRKey (userPRkey) {
	userPRkey = userPRkey ? userPRkey.trim() : '';
	glbCookies.userPRkey = userPRkey;
	glbCookies.userPRkeyClean = cleanText(userPRkey);
	zvvySaveCookie ("userPRkey", glbCookies.userPRkey);
	zvvySaveCookie ("userPRkeyClean", glbCookies.userPRkeyClean);
}

function saveUserSPRKey (userSPRkey) {
	userSPRkey = userSPRkey ? userSPRkey.trim() : '';
	glbCookies.userSPRkey = userSPRkey;
	glbCookies.userSPRkeyClean = cleanText(userSPRkey);
	zvvySaveCookie ("userSPRkey", glbCookies.userSPRkey);
	zvvySaveCookie ("userSPRkeyClean", glbCookies.userSPRkeyClean);
}

/*
**	CALLED FROM HTML
**	chooseFB
**		called when user clicks "Or login with Facebook" 
*/
function chooseFB() {
	$("#fblogin_link").addClass("invisible");
	$("#fblogin_action").removeClass("invisible");
	gtag('event', 'fb.logincode.load');
}

/*
**	FUTURE DEVELOPMENT: 
**		Prevent Default Behaviors on this page
**
**	document.addEventListener("keydown", function(e) {
**	  if ( (e.keyCode == 83 || e.keyCode == 116) && (navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey)) {
**	    e.preventDefault();
**	    // Process event...
**	    $("#errormessage").html(((navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey) ? 'NoCtrl' : 'ctrl' ) + "keycode:" + e.keyCode + " keypress:" + e.which);
**		
**	  }
**	}, false)
**
**	Preferred implementation is shown below
**
**	Forbidden Combinations (Cannot be intercepted)
**		CtrlN
**		CtrlShiftN
**		CtrlT
**		CtrlShiftT
**		CtrlW
**		CtrlShiftW
*/
function KeyDownEventHandler(event) {
    /*
	if ( event.ctrlKey || event.metaKey) {
        switch (String.fromCharCode(event.which).toLowerCase()) {
        case 's':
        case 'f':
        case 't':
        case 'g':
            event.preventDefault();
		default:
            $("#errormessage").html('ctrl-' + String.fromCharCode(event.which).toLowerCase());
            break;
        }
    } else {
		$("#errormessage").html(
			(
				(navigator.platform.match("Mac") ? event.metaKey : event.ctrlKey) ? 'CTRL' : '' ) + 
				"keycode:" + event.keyCode + " keypress:" + event.which + ' char:' + String.fromCharCode(event.which).toLowerCase()
			);
	}
	*/
	
	}

	
$(window).bind( 'keydown', KeyDownEventHandler );

/* 
**	Document Ready (Constructor) 
**		jQuery function executed when document has finished loading 
*/
$(document).ready( docConstructor );	// End of document ready function
