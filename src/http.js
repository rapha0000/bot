const fastify = require('fastify')();
const oauth = require('@fastify/oauth2');
// const { randomBytes } = require('crypto');
const { short } = require('leeks.js');
const { join } = require('path');
const { files } = require('node-dir');

module.exports = client => {
	// cors plugin
	fastify.register(require('@fastify/cors'), {
		credentials: true,
		methods: ['DELETE', 'GET', 'PATCH', 'PUT', 'POST'],
		origin: true,
	});

	// oauth2 plugin
	fastify.register(oauth, {
		callbackUri: `${process.env.HTTP_EXTERNAL}/auth/callback`,
		credentials: {
			auth: oauth.DISCORD_CONFIGURATION,
			client: {
				id: client.user.id,
				secret: process.env.DISCORD_SECRET,
			},
		},
		name: 'discord',
		scope: ['identify'],
		startRedirectPath: '/auth/login',
	});

	// cookies plugin
	fastify.register(require('@fastify/cookie'));

	// jwt plugin
	fastify.register(require('@fastify/jwt'), {
		cookie: {
			cookieName: 'token',
			signed: false,
		},
		// secret: randomBytes(16).toString('hex'),
		secret: process.env.ENCRYPTION_KEY,
	});

	// auth
	fastify.decorate('authenticate', async (req, res) => {
		try {
			const data = await req.jwtVerify();
			// if (data.payload.expiresAt < Date.now()) res.redirect('/auth/login');
			if (data.payload.expiresAt < Date.now()) {
				return res.code(401).send({
					error: 'Unauthorised',
					message: 'You are not authenticated.',
					statusCode: 401,

				});
			}
		} catch (err) {
			res.send(err);
		}
	});

	fastify.decorate('isAdmin', async (req, res) => {
		try {
			const userId = req.user.payload.id;
			const guildId = req.params.guild;
			const guild = client.guilds.cache.get(guildId);
			if (!guild) {
				return res.code(404).send({
					error: 'Not Found',
					message: 'The requested resource could not be found.',
					statusCode: 404,

				});
			}
			const guildMember = await guild.members.fetch(userId);
			const isAdmin = guildMember?.permissions.has('MANAGE_GUILD') || client.supers.includes(userId);
			if (!isAdmin) {
				return res.code(403).send({
					error: 'Forbidden',
					message: 'You are not permitted for this action.',
					statusCode: 403,

				});
			}
		} catch (err) {
			res.send(err);
		}
	});

	// body processing
	fastify.addHook('preHandler', (req, res, done) => {
		if (req.body && typeof req.body === 'object') {
			for (const prop in req.body) {
				if (typeof req.body[prop] === 'string') {
					req.body[prop] = req.body[prop].trim();
				}
			}
		}
		done();
	});

	// logging
	fastify.addHook('onResponse', (req, res, done) => {
		done();
		const status = (res.statusCode >= 500
			? '&4'
			: res.statusCode >= 400
				? '&6'
				: res.statusCode >= 300
					? '&3'
					: res.statusCode >= 200
						? '&2'
						: '&f') + res.statusCode;
		let responseTime = res.getResponseTime().toFixed(2);
		responseTime = (responseTime >= 20
			? '&c'
			: responseTime >= 5
				? '&e'
				: '&a') + responseTime + 'ms';
		client.log.info.http(short(`${req.ip} ${req.method} ${req.routerPath ?? '*'} &m-+>&r ${status}&b in ${responseTime}`));
		done();
	});

	fastify.addHook('onError', async (req, res, err) => client.log.error.http(err));

	// route loading
	const dir = join(__dirname, '/routes');

	files(dir, {
		exclude: /^\./,
		match: /.js$/,
		sync: true,
	}).forEach(file => {
		const path = file
			.substring(0, file.length - 3) // remove `.js`
			.substring(dir.length) // remove higher directories
			.replace(/\\/g, '/') // replace `\` with `/` because Windows is stupid
			.replace(/\[(\w+)\]/gi, ':$1') // convert [] to :
			.replace('/index', '') || '/'; // remove index
		const route = require(file);

		Object.keys(route).forEach(method => fastify.route({
			config: { client },
			method: method.toUpperCase(),
			path,
			...route[method](fastify),
		})); // register route
	});

	// start server
	fastify.listen({ port: process.env.HTTP_BIND }, (err, addr) => {
		if (err) client.log.error.http(err);
		else client.log.success.http(`Listening at ${addr}`);
	});
};