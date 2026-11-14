<script>
	import favicon from '#lib/assets/favicon.svg';

	let { children } = $props();


</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.3.1/css/all.min.css" />

</svelte:head>

{@render children()}
