const http = require('http');
const https = require('https');
const request = require('request');

const SHIPSIO_HOST = 'shipsio.com';
const SHIPSIO_PORT = '443';
const SHIPSIO_HTTP = https;

const SIGNALK_HOST = 'localhost';
const SIGNALK_PORT = '3000';

module.exports = function (app) {
	const showError =
		app.showerror || app.error ||
		(err => {
			console.error(err)
		})
	const logError =
		app.error ||
		(err => {
			console.error(err)
		})
	const debug =
		app.debug ||
		(msg => {
			console.log(msg)
		})

	const plugin = {
		unsubscribes: []
	}

	plugin.id = 'shipsio-signalk-plugin';
	plugin.name = 'ShipsIO AIS Network Exchanger';
	plugin.description = 'Exchange AIS messages with ShipsIO open AIS Network. Enabling this will automatically return close by ships and integrate them into your AIS stream.';

	plugin.schema = () => ({
		title: 'Exchange AIS messages with ShipsIO',
		type: 'object',
		properties: {
			interval: {
				type: 'number',
				title: 'Interval between AIS reports (600 seconds is default and 120 seconds is minimum)',
				default: 600    //Every 10 mins
			},
			key: {
				type: 'string',
				title: 'AIS key. Get it from https://shipsio.com. The key is free, subscription is NOT required. Go to Accounts page to copy the key and paste it here.',
				default: ''
			},
			integrate: {
				type: 'boolean',
				title: 'Get ships around me and integrate them into my AIS SignalK feed',
				default: false
			}
		}
	})

	plugin.downloadJSON = function (src) {
		return new Promise((resolve, reject) => {
			try {
				const maxFileSize = 1024 * 1024 * 1; // 1 MB
				let contentBuffer = [];
				let totalBytesInBuffer = 0;

				debug('Fetching local AIS vessels: ' + src)
				const req = request(src, {
					method: "GET",
					headers: {
						'Accept': 'application/json'
					}
				}, function (err, headRes) {
					if (err) {
						reject(err);
					} else if (headRes.statusCode !== 200) {
						logError(headRes.statusMessage + ': ' + src);
					} else {
						// console.log(headRes.statusMessage + ': ' + src);
					}
				});
				req.on('data', function (data) {
					contentBuffer.push(data);
					totalBytesInBuffer += data.length;

					// Look to see if the file size is too large.
					if (totalBytesInBuffer > maxFileSize) {
						req.pause();

						req.header('Connection', 'close');
						req.status(413).json({error: `The file size exceeded the limit of ${maxFileSize} bytes`});

						req.connection.destroy();
					}
				});

				// Could happen if the client cancels the upload.
				req.on('aborted', function () {
					// Nothing to do with buffering, garbage collection will clean everything up.
					reject(new Error('aborted'));
				});

				req.on('end', function () {
					contentBuffer = Buffer.concat(contentBuffer, totalBytesInBuffer).toString();
					if (req.response && (req.response.statusCode === 200)) {
						const json = JSON.parse(contentBuffer);
						resolve(json);
					}
					else {
						reject(contentBuffer);
					}
				});

				req.on('error', function (error) {
					reject(error);
				});
			} catch (error) {
				logError(error);
			}
		})
	}

	plugin.vesselDict = {};
	plugin.isValidKey = true;   //Assume valid until otherwise proven

	plugin.fetchVessels = function (url) {
		plugin.downloadJSON(url)
			.then(async result => {
				let vessels = [];
				let resultCount = 0;
				for (const property in result) {
					try {
						if (result.hasOwnProperty(property)) {
							// debug(property);
							resultCount++;
							let vesselRaw = result[property];
							let vessel = {};
							if (vesselRaw.mmsi) {
								vessel.MMSI = Number.parseInt(vesselRaw.mmsi);
							}
							vessel.Name = vesselRaw.name;
							if (vesselRaw.navigation && vesselRaw.navigation.position) {
								vessel.Lat = vesselRaw.navigation.position.value.latitude;
								vessel.Lon = vesselRaw.navigation.position.value.longitude;
								if (vesselRaw.navigation.speedOverGround) {
									vessel.Speed = vesselRaw.navigation.speedOverGround.value;
								}
								if (vesselRaw.navigation.courseOverGroundTrue) {
									vessel.Course = vesselRaw.navigation.courseOverGroundTrue.value;
								}
								if (vesselRaw.navigation.headingTrue) {
									vessel.Heading = vesselRaw.navigation.headingTrue.value;
								}
							}
							if (vesselRaw.communication) {
								vessel.Callsign = vesselRaw.communication.callsignVhf;
							}
							if (vesselRaw.design) {
								if (vesselRaw.design.length) {
									vessel.Length = vesselRaw.design.length.value.overall;
								}
								if (vesselRaw.design.beam) {
									vessel.Beam = vesselRaw.design.beam.value;
								}
								if (vesselRaw.design.draft && vesselRaw.design.draft.value) {
									if (vesselRaw.design.draft && vesselRaw.design.draft.value.maximum) {
										vessel.Draft = vesselRaw.design.draft.value.maximum;
									} else if (vesselRaw.design.draft && vesselRaw.design.draft.value.current) {
										vessel.Draft = vesselRaw.design.draft.value.current;
									}
								}
								if (vesselRaw.design.aisShipType) {
									vessel.AISType = vesselRaw.design.aisShipType.value.id;
									vessel.AISTypeDescription = vesselRaw.design.aisShipType.value.name;
								}
							}
							if (vesselRaw.sensors && vesselRaw.sensors.ais && vesselRaw.sensors.ais.class) {
								vessel.AISClass = vesselRaw.sensors.ais.class.value;
							}
							if (vesselRaw.registrations && vesselRaw.registrations.imo && vesselRaw.registrations.imo.startsWith('IMO ')) {
								vessel.IMO = vesselRaw.registrations.imo.replace('IMO ', '');
							}
							if (vesselRaw.Name) {
								vessel.Name = vesselRaw.Name;
							}
							if (vesselRaw.Lat) {
								vessel.Lat = vesselRaw.Lat;
							}
							if (vesselRaw.Lon) {
								vessel.Lon = vesselRaw.Lon;
							}
							if (vesselRaw.Speed) {
								vessel.Speed = vesselRaw.Speed;
							}
							if (vesselRaw.Course) {
								vessel.Course = vesselRaw.Course;
							}
							if (vesselRaw.Heading) {
								vessel.Heading = vesselRaw.Heading;
							}
							if (vesselRaw.callsign) {
								vessel.Callsign = vesselRaw.callsign;
							}
							if (vesselRaw.Modified) {
								vessel.Modified = vesselRaw.Modified;
							}

							// debug(vessel);
							if (vessel.MMSI) {
								//Before posting, check against vesselDict
								if (plugin.vesselDict[vessel.MMSI]) {
									//We've posted this before, let's strip any data that hasn't changed
									const previuslyPostedVessel = plugin.vesselDict[vessel.MMSI];
									// debug(previuslyPostedVessel);
									for (const property in previuslyPostedVessel) {
										if (property !== 'MMSI') {
											if (vessel[property] === previuslyPostedVessel[property]) {
												//Delete data that is same as previously sent, to minimize data transfer
												delete vessel[property];
											}
										}
									}
								}
								if (!vessel.IsNetAIS) {
									vessels.push(vessel);
								}
								else {
									console.debug('Skipped NetAIS vessel: ' + vessel.MMSI);
								}
							}
						}
					}
					catch (e) {
						logError(e);
					}
				}
				debug(resultCount + " local AIS vessels fetched");
				if (vessels.length > 0) {
					//Post all vessels along with a authorization key (optional) and position (optional)
					const data = {
						Key: plugin.options.key,
						Integrate: plugin.options.integrate,
						Lat: vessels[0].Lat,    //Assume first vessel is self
						Lon: vessels[0].Lon,
						Vessels: vessels
					}
					debug("Posting "+vessels.length+" vessels to ShipsIO");
					const result = await plugin.postToShipsIO(data);
					if (result) {
						debug('Vessels posted to ShipsIO: ' + result.Posted);
						//Make sure all posted vessels are in vessel dictionary
						for (const index in vessels) {
							const postedVessel = vessels[index];
							if (!plugin.vesselDict[postedVessel.MMSI]) {
								plugin.vesselDict[postedVessel.MMSI] = postedVessel;
							}
						}
						if (result.vessels) {
							debug('Vessels returned from ShipsIO: ' + result.vessels.length);
							let missingVessels = [];
							for (let i=0; i<result.vessels.length; i++) {
								let newVessel = result.vessels[i];
								if (!plugin.vesselDict[newVessel.MMSI]) {
									//New vessel, not posted to ShipsIO
									missingVessels.push(newVessel);
								}
							}
							debug("New net AIS vessels: " + missingVessels.length);
							for(const index in missingVessels) {
								plugin.handleNewVessel(missingVessels[index]);
							}
						}
						else {
							debug('Vessels returned from ShipsIO: 0');
						}
					}
				}
			})
			.catch(e => {
				logError(e);
			})
	}

	plugin.prepareValues = function (vessel) {
		let values = [];

		if (vessel.MMSI) {
			values.push({
				path: '',
				value: {mmsi: vessel.MMSI}
			});
		}
		if (vessel.Name) {
			values.push({
				path: '',
				value: {name: vessel.Name}
			});
		}
		if (vessel.IMO) {
			values.push({
				path: 'registrations',
				value:{imo: vessel.IMO}
			});
		}
		if (vessel.Callsign) {
			values.push({
				path: 'communication.callsignVhf',
				value: vessel.Callsign
			});
		}
		if (true) {
			values.push({
				path: 'communication.netAIS',
				value: true
			});
		}
		if (vessel.Lon && vessel.Lat) {
			values.push({
				path: 'navigation.position',
				value: {longitude: vessel.Lon, latitude: vessel.Lat}
			});
		}
		if (vessel.Course) {
			values.push({
				path: 'navigation.courseOverGroundTrue',
				value: vessel.Course
			});
		}
		if (vessel.Speed) {
			values.push({
				path: 'navigation.speedOverGround',
				value: vessel.Speed
			});
		}
		if (vessel.Heading) {
			values.push({
				path: 'navigation.headingTrue',
				value: vessel.Heading
			});
		}
		if (vessel.Modified) {
			values.push({
				path: 'navigation.datetime',
				value: vessel.Modified
			});
		}
		if (vessel.AISType && vessel.AISTypeDescription) {
			values.push({
				path: 'design.aisShipType',
				value: {id: vessel.AISType,name : vessel.AISTypeDescription} 	//
			});
		}
		if (vessel.Length) {
			values.push({
				path: 'design.length',
				value:{"overall": vessel.Length}
			});
		}
		if (vessel.Beam) {
			values.push({
				path: 'design.beam',
				value: vessel.Beam
			});
		}
		if (vessel.Draft) {
			values.push({
				path: 'design.draft',
				value:{"current": vessel.Draft,"maximum":vessel.Draft}
			});
		}

		return values;
	}

	plugin.handleNewVessel = function (vessel) {
		if (vessel.MMSI && vessel.Modified) {
			debug('Handling NET AIS vessel:' + vessel.Name);
			let values = plugin.prepareValues(vessel);
			app.handleMessage(plugin.id, {
				context: 'vessels.urn:mrn:imo:mmsi:' + vessel.MMSI,
				updates: [
					{
						values: values,
						source: {label: plugin.id},
						timestamp: vessel.Modified,
					}
				]
			});
		}
	}

	plugin.start = function (options) {
		try {
			debug('Starting ShipsIO plugin');
			if (!options.interval || (options.interval < 120)) {
				options.interval = 120;
			}
			debug('Interval: ' + options.interval);
			debug('Key: ' + options.key);
			plugin.options = options;
			let url = `http://${SIGNALK_HOST}:${SIGNALK_PORT}/signalk/v1/api/vessels`;
			debug('Url: ' + url);

			if (!options.key || (options.key.length < 1)) {
				logError('Missing setting: key');
			}
			else {
				//Setup an interval to perform fetchVessels (does not fire right away)
				plugin.intervalId = setInterval(() => {
					try {
						plugin.fetchVessels(url);
					} catch (e) {
						logError(e);
					}
				}, options.interval * 1000);
				//Defer first fetchVessels, to let NMEA get some data first
				plugin.intervalId = setTimeout(() => {
					try {
						plugin.fetchVessels(url);
					} catch (e) {
						logError(e);
					}
				}, 30000)
			}
		}
		catch (e) {
			logError(e);
		}
	}

	plugin.postData = function (url = "", data = {}) {
		return new Promise((resolve, reject) => {

			try {
				const post_data = JSON.stringify(data);
				const datalength = Buffer.byteLength(post_data);

				const maxFileSize = 1024 * 1024 * 1; // 1 MB
				let contentBuffer = '';
				let totalBytesInBuffer = 0;

				debug('Size to post: ' + datalength);

				// An object of options to indicate where to post to
				const post_options = {
					host: SHIPSIO_HOST,
					port: SHIPSIO_PORT,
					path: url,
					method: 'POST',
					headers: {
						"Content-Type": "application/json",
						'Content-Length': datalength
					}
				};

				// Set up the request
				const post_req = SHIPSIO_HTTP.request(post_options, function (res) {
					// debug(`STATUS: ${res.statusCode}`);
					// debug(`HEADERS: ${JSON.stringify(res.headers)}`);
					res.setEncoding('utf8');
					res.on('data', function (data) {
						contentBuffer += data;
						totalBytesInBuffer += data.length;

						// Look to see if the file size is too large.
						if (totalBytesInBuffer > maxFileSize) {
							res.pause();

							res.header('Connection', 'close');
							res.status(413).json({error: `The file size exceeded the limit of ${maxFileSize} bytes`});

							res.connection.destroy();
						}

					});
					res.on('end', function () {
						try {
							debug('Bytes returned: ' + totalBytesInBuffer);
							// contentBuffer = Buffer.concat(contentBuffer, totalBytesInBuffer).toString();
							if (contentBuffer.startsWith('{"Posted":')) {
								debug("Successfully posted to ShipsIO:");
								const json = JSON.parse(contentBuffer);
								resolve(json);
							} else {
								if (contentBuffer === "Invalid key") {
									//See if this is first time
									if (plugin.isValidKey) {
										//It's first time, set to false to only send this once
										plugin.isValidKey = false;
										showError(new Error('Invalid ShipsIO Key'));
									}
								}
								reject(new Error(contentBuffer));
							}
						} catch (e) {
							reject(e);
						}
					});
					res.on('error', function (e) {
						logError(e);
						reject(e);
					})
					// Could happen if the client cancels the upload.
					res.on('aborted', function () {
						// Nothing to do with buffering, garbage collection will clean everything up.
						logError(e);
						reject(new Error('aborted'));
					});
				});

				post_req.on('error', (e) => {
					logError(`Problem with request: ${e.message}`);
					reject(e);
				});

				// post the data
				post_req.write(post_data);
				post_req.end();
			} catch (e) {
				logError(e);
				reject(e);
			}
		});
	}

	plugin.postToShipsIO = async (data) => {
		try {
			let result = await plugin.postData("/public/ais/signalk", data);
			return result;
		}
		catch (e) {
			logError(e);
			return null;
		}
	}

	plugin.stop = function () {
		debug('Stopping ShipsIO plugin');
		if (plugin.intervalId) {
			clearInterval(plugin.intervalId);
		}
		plugin.unsubscribes.forEach(f => f())
	}

	return plugin;

};