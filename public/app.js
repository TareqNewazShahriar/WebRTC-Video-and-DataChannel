const configuration = {
	iceServers: [
		{
			urls: [
				'stun:stun1.l.google.com:19302',
				'stun:stun2.l.google.com:19302',
			],
		},
	],
	iceCandidatePoolSize: 10,
};

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomId = null;

function init() {
	document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
	document.querySelector('#hangupBtn').addEventListener('click', hangUp);
	document.querySelector('#createBtn').addEventListener('click', createRoom);
	document.querySelector('#joinBtn').addEventListener('click', joinRoom);
}

async function createRoom() {
	document.querySelector('#createBtn').disabled = true;
	document.querySelector('#joinBtn').disabled = true;
	const db = firebase.firestore();
	const roomRef = await db.collection('rooms').doc();

	log('Create PeerConnection with configuration: ', configuration);
	peerConnection = new RTCPeerConnection(configuration);

	registerPeerConnectionListeners();

	localStream.getTracks().forEach(track => {
		peerConnection.addTrack(track, localStream);
	});

	// Code for creating a room below
	const offer = await peerConnection.createOffer();
	await peerConnection.setLocalDescription(offer);
	log('Created offer:', offer);

	const roomWithOffer = {
		'offer': {
			type: offer.type,
			sdp: offer.sdp,
		},
	};
	await roomRef.set(roomWithOffer);
	roomId = roomRef.id;
	log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
	document.getElementById('createdRoomId').value = roomRef.id;
	document.getElementById('created-id').style.display = 'block';
	// Code for creating a room above


	// Code for collecting ICE candidates below
	const callerCandidatesCollection = roomRef.collection('callerCandidates');

	peerConnection.addEventListener('icecandidate', event => {
		if (!event.candidate) {
			log('Got final candidate!');
			return;
		}
		log('Got candidate: ', event.candidate);
		callerCandidatesCollection.add(event.candidate.toJSON());
	});
	// Code for collecting ICE candidates above


	peerConnection.addEventListener('track', event => {
		log('Got remote track:', event.streams[0]);
		event.streams[0].getTracks().forEach(track => {
			log('Add a track to the remoteStream:', track);
			remoteStream.addTrack(track);
		});
	});

	// Listening for remote session description below
	roomRef.onSnapshot(async snapshot => {
		const data = snapshot.data();
		if (!peerConnection.currentRemoteDescription && data && data.answer) {
			log('Got remote description: ', data.answer);
			const rtcSessionDescription = new RTCSessionDescription(data.answer);
			await peerConnection.setRemoteDescription(rtcSessionDescription);
		}
	});
	// Listening for remote session description above

	// Listen for remote ICE candidates below
	roomRef.collection('calleeCandidates').onSnapshot(snapshot => {
		snapshot.docChanges().forEach(async change => {
			if (change.type === 'added') {
				let data = change.doc.data();
				log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
				await peerConnection.addIceCandidate(new RTCIceCandidate(data));
			}
		});
	});
	// Listen for remote ICE candidates above
}

function joinRoom() {
	document.querySelector('#createBtn').disabled = true;
	document.querySelector('#joinBtn').disabled = true;

	joinRoomById(prompt("Enter Room ID"));
}

async function joinRoomById(roomId) {
	const db = firebase.firestore();
	const roomRef = db.collection('rooms').doc(`${roomId}`);
	const roomSnapshot = await roomRef.get();
	log('Got room:', roomSnapshot.exists);

	if (roomSnapshot.exists) {
		log('Create PeerConnection with configuration: ', configuration);
		peerConnection = new RTCPeerConnection(configuration);
		registerPeerConnectionListeners();
		localStream.getTracks().forEach(track => {
			peerConnection.addTrack(track, localStream);
		});

		// Code for collecting ICE candidates below
		const calleeCandidatesCollection = roomRef.collection('calleeCandidates');
		peerConnection.addEventListener('icecandidate', event => {
			if (!event.candidate) {
				log('Got final candidate!', event.candidate);
				return;
			}
			log('Got candidate: ', event.candidate);
			calleeCandidatesCollection.add(event.candidate.toJSON());
		});
		// Code for collecting ICE candidates above

		peerConnection.addEventListener('track', event => {
			log('Got remote track:', event.streams[0]);
			event.streams[0].getTracks().forEach(track => {
				log('Add a track to the remoteStream:', track);
				remoteStream.addTrack(track);
			});
		});

		// Code for creating SDP answer below
		const offer = roomSnapshot.data().offer;
		log('Got offer:', offer);
		await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
		const answer = await peerConnection.createAnswer();
		log('Created answer:', answer);
		await peerConnection.setLocalDescription(answer);

		const roomWithAnswer = {
			answer: {
				type: answer.type,
				sdp: answer.sdp,
			},
		};
		await roomRef.update(roomWithAnswer);
		// Code for creating SDP answer above

		// Listening for remote ICE candidates below
		roomRef.collection('callerCandidates').onSnapshot(snapshot => {
			snapshot.docChanges().forEach(async change => {
				if (change.type === 'added') {
					let data = change.doc.data();
					log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
					await peerConnection.addIceCandidate(new RTCIceCandidate(data));
				}
			});
		});
		// Listening for remote ICE candidates above
	}
}

async function openUserMedia(e) {
	const stream = await navigator.mediaDevices.getUserMedia(
		{ video: true, audio: true });
	document.querySelector('#localVideo').srcObject = stream;
	localStream = stream;
	remoteStream = new MediaStream();
	document.querySelector('#remoteVideo').srcObject = remoteStream;

	log('Stream:', document.querySelector('#localVideo').srcObject);
	document.querySelector('#cameraBtn').disabled = true;
	document.querySelector('#joinBtn').disabled = false;
	document.querySelector('#createBtn').disabled = false;
	document.querySelector('#hangupBtn').disabled = false;
}

async function hangUp(e) {
	const tracks = document.querySelector('#localVideo').srcObject.getTracks();
	tracks.forEach(track => {
		track.stop();
	});

	if (remoteStream) {
		remoteStream.getTracks().forEach(track => track.stop());
	}

	if (peerConnection) {
		peerConnection.close();
	}

	document.querySelector('#localVideo').srcObject = null;
	document.querySelector('#remoteVideo').srcObject = null;
	document.querySelector('#cameraBtn').disabled = false;
	document.querySelector('#joinBtn').disabled = true;
	document.querySelector('#createBtn').disabled = true;
	document.querySelector('#hangupBtn').disabled = true;
	document.querySelector('#currentRoom').innerText = '';

	// Delete room on hangup
	if (roomId) {
		const db = firebase.firestore();
		const roomRef = db.collection('rooms').doc(roomId);
		const calleeCandidates = await roomRef.collection('calleeCandidates').get();
		calleeCandidates.forEach(async candidate => {
			await candidate.ref.delete();
		});
		const callerCandidates = await roomRef.collection('callerCandidates').get();
		callerCandidates.forEach(async candidate => {
			await candidate.ref.delete();
		});
		await roomRef.delete();
	}

	// document.location.reload(true);
}

function registerPeerConnectionListeners() {
	peerConnection.addEventListener('icegatheringstatechange', () => {
		log(
			`ICE gathering state changed: ${peerConnection.iceGatheringState}`);
	});

	peerConnection.addEventListener('connectionstatechange', () => {
		log(`Connection state change: ${peerConnection.connectionState}`);
	});

	peerConnection.addEventListener('signalingstatechange', () => {
		log(`Signaling state change: ${peerConnection.signalingState}`);
	});

	peerConnection.addEventListener('iceconnectionstatechange ', () => {
		log(
			`ICE connection state change: ${peerConnection.iceConnectionState}`);
	});
}

init();

var clog = document.getElementById('log');
function log(...params) {
	clog.innerHTML += '\n\n' + params.map(x => JSON.stringify(x)).join(' \\\\ ');
	console.log.apply(console, params);
}