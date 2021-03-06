var logviewerApp = angular.module("logviewerApp");
function getChanges(obj1,obj2) {
	var res = {};
	var keys = Object.keys(obj1);
	for(var i=0;i<keys.length;++i) {
		var key = keys[i];
		if(obj1[key]!==obj2[key]) res[key] = obj2[key];
	}
	return res;
}

function getListChanges(l1,l2) {
	var res = [];
	for(var i=0;i<l2.length;++i) {
		if(/^\w+$/.test(l2[i].nick) == false) continue;
		var inlist = false;
		for(var j=0;j<l1.length;++j) {
			if(l2[i].nick == l1[j].nick && l2[i].level == l1[j].level) {
				inlist = true;
				break;
			}
		}
		if(inlist === false) {
			res.push(l2[i]);
		}
	}
	return res;
}

logviewerApp.controller("SettingsController", function($rootScope, $scope, $http, $stateParams, $mdToast, $mdDialog, logviewerSocket){
	$scope.settings = {
		active: 0,
		modlogs: 0,
		viewlogs: 0,
		viewmodlogs: 5,
		viewcomments: 5,
		writecomments: 5,
		deletecomments: 10
	}
	$scope.loadStatus = 0;
	$scope.levels = [];
	$scope.userObject = null;
	$scope.channel = $stateParams.channel.toLowerCase();
	var oldsettings = angular.copy($scope.settings);
	var oldlevels = angular.copy($scope.levels);
	
	$http.jsonp("/api/channel/"+$stateParams.channel+"/?token="+$rootScope.auth.token+"&callback=JSON_CALLBACK").then(function(response){
		$scope.settings = angular.extend($scope.settings, response.data.channel);
		$scope.userObject = response.data.me;
		oldsettings = angular.copy($scope.settings);
		$scope.loadStatus = response.data.channel==null?-1:1;
	});
	
	$http.jsonp("/api/levels/"+$stateParams.channel+"/?token="+$rootScope.auth.token+"&callback=JSON_CALLBACK").then(function(response){
		$scope.levels = response.data;
		$scope.addEmptyRow();
		oldlevels = angular.copy($scope.levels);
	});
	
	$scope.settingsChanged = function() {
		var changedsettings = getChanges(oldsettings,$scope.settings);
		if(Object.keys(changedsettings).length > 0) {
			return true;
		}
		var changedlevels = getListChanges(oldlevels,$scope.levels);
		return changedlevels.length!=0;
	}
	
	var errorToast = function(reason) {
		var reasonString = {
			403: "Error: Access denied.",
			404: "Error: Channel not found."
		}[reason.status] || "An unknown error occurred. Please try again later.";
		$mdToast.show($mdToast.simple({
			parent: "#main",
			textContent: reasonString,
			position: "top right",
			hideDelay: 3000
		}));
	};
	
	var saveSettings = function() {
		var changedsettings = getChanges(oldsettings,$scope.settings);
		var changed = [];
		if(Object.keys(changedsettings).length > 0) {
			changed.push("settings");
			return new Promise(function(r,j) {
				$http.post("/api/settings/"+$stateParams.channel, {token: $rootScope.auth.token, settings: changedsettings}).then(function(){r(changed);},j);
			});
		} else {
			return Promise.resolve(changed);
		}
	}
	
	var saveLevels = function(changed) {
		var changedlevels = getListChanges(oldlevels,$scope.levels);
		if(changedlevels.length!=0) {
			changed.push("levels");
			return new Promise(function(r,j) {
				$http.post("/api/levels/"+$stateParams.channel, {token: $rootScope.auth.token, levels: changedlevels}).then(function(){r(changed);},j);
			});
		} else {
			return Promise.resolve(changed);
		}
	}
	
	$scope.save = function() {
		saveSettings()
			.then(saveLevels)
			.then(function(changed){
				oldsettings = angular.copy($scope.settings);
				oldlevels = angular.copy($scope.levels);
				$mdToast.show($mdToast.simple({
					parent: "#main",
					textContent: changed.join(" and ") + " saved",
					position: "top right",
					hideDelay: 3000
				}));
			}, errorToast);
	}
	
	$scope.addEmptyRow = function() {
		if($scope.levels.length > 0) {
			var lastrow = $scope.levels[$scope.levels.length - 1];
			if(lastrow.nick != "") {
				$scope.levels.push({nick: "", level: 0});
			}
		}
		else {
			$scope.levels.push({nick: "", level: 0});
		}
	}
	
	$scope.events = [];
	
	var prettyToggle = {
		"active": "the logviewer",
		"modlogs": "mod logs"
	};
	
	var prettyPerm = {
		"viewlogs": "view logs",
		"viewmodlogs": "view mod logs",
		"viewcomments": "view comments",
		"writecomments": "write comments",
		"deletecomments": "delete comments"
	};
	
	var userGroup = {
		"-10": "banned",
		0: "everyone",
		1: "logged in user",
		2: "regular",
		5: "moderator",
		7: "super-moderator",
		10: "manager",
		50: "admin",
		1337: "developer"
	};
	var commentAction = {
		"add": "added",
		"edit": "edited",
		"delete": "deleted"
	};
	var eventParser = {
		"channel": function(event) {
			if(event.name == "add") return "added the logviewer to the channel.";
		},
		"setting": function(event) {
			if(prettyToggle[event.name]) {
				if(event.data == "1") {
					return "enabled "+prettyToggle[event.name]+"."
				} else {
					return "disabled "+prettyToggle[event.name]+"."
				}
			} else if(prettyPerm[event.name]) {
				return "set "+prettyPerm[event.name]+" to "+(userGroup[event.data] || event.data)+(event.data > 0?"s and higher only":"");
			}
		},
		"level": function(event) {
			return "set the user level of "+event.name+" to "+userGroup[event.data];
		},
		"comment": function(event) {
			var comment = JSON.parse(event.data);
			if(comment.author != event.user) {
				return commentAction[event.name]+" a comment by "+comment.author;
			}
		},
		"system": function(event) {
			return event.data;
		},
		"command": function(event) {
			return "used command "+event.data;
		}
	}
	
	var addEvent = function(ev) {
		if(eventParser[ev.action]) {
			var desc = eventParser[ev.action](ev);
			if(desc) {
				$scope.events.push({action: ev.action, user: ev.user, desc: desc, time: ev.time});
			}
		}
	}
	
	$http.jsonp("/api/events/"+$stateParams.channel+"/?token="+$rootScope.auth.token+"&callback=JSON_CALLBACK").then(function(result) {
		$scope.events = [];
		for(var i=0;i<result.data.length;++i) {
			addEvent(result.data[i]);
		}
	
		logviewerSocket.on("connect", function(){
			console.log("Connected to socket.io");
		});
		logviewerSocket.emit("token",$rootScope.auth.token);
		logviewerSocket.emit("subscribe","events-"+$stateParams.channel);
		logviewerSocket.on("adminlog", addEvent);
		logviewerSocket.on("ismodded", function(ismodded){
			$scope.settings.isModded = ismodded;
			oldsettings.isModded = ismodded;
			if(ismodded) addEvent({time: Math.floor(Date.now()/1000), action: "system", user: "", "name": "ismodded", "data": "Moderator status detected."});
			else {
				addEvent({time: Math.floor(Date.now()/1000), action: "system", user: "", "name": "ismodded", "data": "Moderator status lost."});
				$scope.settings.modlogs = 0;
				oldsettings.modlogs = 0;
			}
		});
	});
	
	$scope.$on('$destroy', function (event) {
		logviewerSocket.emit("unsubscribe","events-"+$stateParams.channel);
	});
});

 
function isScrollBottom(element) {
	return Math.abs(element.scrollTop - (element.scrollHeight - element.offsetHeight)) < 5;
}

logviewerApp.directive('scrollToBottom', function () {
	return {
		link: function (scope, el) {
			var element = el[0];
			console.log(element);
			element.scrollTop = element.scrollHeight;
			var mutObs = new MutationObserver(function (event) {
				element.scrollTop = element.scrollHeight;
			});
			mutObs.observe(element, {childList: true});
		}
	}
});