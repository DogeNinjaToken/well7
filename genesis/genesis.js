(() => {
  'use strict';

  const E = window.ethers;
  const C = window.DEEPWELL_FARM || {};
  const ENV = window.DEEPWELL_ENV || {};
  const RPC_URL = C.rpcUrl || ENV.rpcUrl || '';
  const EXPLORER_URL = C.explorerUrl || ENV.explorerUrl || '';
  const $ = id => document.getElementById(id);
  const SALE = [
    'function start() view returns(uint256)',
    'function end() view returns(uint256)',
    'function softCap() view returns(uint256)',
    'function totalContributed() view returns(uint256)',
    'function finalized() view returns(bool)',
    'function failed() view returns(bool)',
    'function contributions(address) view returns(uint256)',
    'function claimed(address) view returns(bool)',
    'function liquiditySink() view returns(address)',
    'function contribute(uint256)',
    'function finalize()',
    'function claim()',
    'function refund()',
    'function estimateAllocation(address) view returns(uint256)'
  ];
  const TOKEN = [
    'function decimals() view returns(uint8)',
    'function symbol() view returns(string)',
    'function balanceOf(address) view returns(uint256)',
    'function allowance(address,address) view returns(uint256)',
    'function approve(address,uint256) returns(bool)'
  ];
  const SINK = [
    'function totalLiquidity() view returns(uint256)',
    'function router() view returns(address)',
    'function polVault() view returns(address)'
  ];

  let read, contract, signer, account = '', stable;
  let saleStart = 0, saleEnd = 0, chainTime = 0, chainTimeReadAt = 0;
  let saleFinalized = false, saleFailed = false;
  let stableDecimals = 18, stableSymbol = 'tUSDT';

  const valid = address => typeof address === 'string' && E.isAddress(address) && address !== E.ZeroAddress;
  const fmt = (amount, decimals = 18, max = 4) => {
    try {
      return new Intl.NumberFormat('en-GB', { maximumFractionDigits: max })
        .format(Number(E.formatUnits(amount, decimals)));
    } catch {
      return '—';
    }
  };
  const shortAddress = address => `${address.slice(0, 8)}…${address.slice(-6)}`;
  const say = (message, type = '') => {
    $('status').textContent = message;
    $('status').className = `genesis-status ${type}`;
  };
  const chainNow = () => chainTime
    ? chainTime + Math.floor(Math.max(0, Date.now() - chainTimeReadAt) / 1000)
    : Math.floor(Date.now() / 1000);
  const londonDate = timestamp => new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London', timeZoneName: 'short'
  }).format(new Date(timestamp * 1000));

  function setLink(id, address) {
    const link = $(id);
    if (valid(address)) {
      link.href = `${EXPLORER_URL.replace(/\/+$/,'')}/address/${address}`;
      link.hidden = false;
      link.title = address;
    } else {
      link.hidden = true;
    }
  }

  function setAddress(id, address) {
    const field = $(id);
    field.textContent = valid(address) ? shortAddress(address) : '—';
    field.title = valid(address) ? address : '';
  }

  function renderCountdown() {
    if (!saleStart || !saleEnd) return;

    const now = chainNow();
    const digits = $('countdown-digits');
    const state = $('countdown-state');
    let target = null;
    let label = 'Sale closed';
    let note = 'The sale window has ended.';
    let stage = 'Awaiting finalization';
    let stateLabel = 'Awaiting finalization';
    let stateClass = 'is-ended';

    if (saleFailed) {
      label = 'Sale unsuccessful';
      note = 'The soft cap was missed. Mock tUSDT refunds are available.';
      stage = 'Refunds available';
      stateLabel = 'Refunds available';
    } else if (saleFinalized) {
      label = 'Sale finalized';
      note = 'The on-chain sale outcome is final.';
      stage = 'Finalized';
      stateLabel = 'Finalized';
    } else if (now < saleStart) {
      label = 'Sale opens in';
      note = `Opens ${londonDate(saleStart)}`;
      stage = 'Scheduled';
      stateLabel = 'Scheduled';
      stateClass = 'is-waiting';
      target = saleStart;
    } else if (now < saleEnd) {
      label = 'Sale closes in';
      note = `Closes ${londonDate(saleEnd)}`;
      stage = 'Open';
      stateLabel = 'Live';
      target = saleEnd;
    } else {
      label = 'Sale window ended';
      note = 'The contribution window is closed. Finalization is now available.';
    }

    $('countdown-label').textContent = label;
    $('countdown-note').textContent = note;
    $('stage').textContent = stage;
    state.innerHTML = `<i aria-hidden="true"></i> ${stateLabel}`;
    state.className = `countdown-state ${stateClass}`;
    digits.hidden = target === null;

    if (target !== null) {
      const secondsLeft = Math.max(0, target - now);
      const days = Math.floor(secondsLeft / 86400);
      const hours = Math.floor((secondsLeft % 86400) / 3600);
      const minutes = Math.floor((secondsLeft % 3600) / 60);
      const seconds = secondsLeft % 60;
      $('countdown-days').textContent = String(days).padStart(2, '0');
      $('countdown-hours').textContent = String(hours).padStart(2, '0');
      $('countdown-minutes').textContent = String(minutes).padStart(2, '0');
      $('countdown-seconds').textContent = String(seconds).padStart(2, '0');
      $('countdown').setAttribute('aria-label', `${label}: ${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds`);
    } else {
      $('countdown').setAttribute('aria-label', label);
    }

    const started = now >= saleStart;
    const ended = now >= saleEnd;
    $('contribute').disabled = !account || !started || ended || saleFinalized || saleFailed;
    $('finalize').disabled = !account || !ended || saleFinalized || saleFailed;
  }

  async function load() {
    if (!valid(C.genesisAddress) || !valid(C.genesisTestStableAddress) || !valid(C.tokenAddress)) {
      say('The Genesis contracts are not configured yet. Run the WELL7 deployment first.', 'warn');
      return;
    }

    if (!RPC_URL) { say('Testnet RPC is not configured. Set BSC_TESTNET_RPC_URL in .env and rebuild the site.', 'warn'); return; }
    read = new E.JsonRpcProvider(RPC_URL, 97, { staticNetwork: true });
    contract = new E.Contract(C.genesisAddress, SALE, read);
    stable = new E.Contract(C.genesisTestStableAddress, TOKEN, read);

    const [start, end, cap, total, finalized, failed, sinkAddress, latestBlock] = await Promise.all([
      contract.start(), contract.end(), contract.softCap(), contract.totalContributed(),
      contract.finalized(), contract.failed(), contract.liquiditySink(), read.getBlock('latest')
    ]);
    saleStart = Number(start);
    saleEnd = Number(end);
    saleFinalized = finalized;
    saleFailed = failed;
    chainTime = latestBlock ? Number(latestBlock.timestamp) : Math.floor(Date.now() / 1000);
    chainTimeReadAt = Date.now();

    const [decimals, symbol] = await Promise.all([stable.decimals(), stable.symbol()]);
    stableDecimals = Number(decimals);
    stableSymbol = symbol;
    const raised = fmt(total, stableDecimals);
    const goal = fmt(cap, stableDecimals);
    $('raised').textContent = `${raised} ${stableSymbol}`;
    $('softcap').textContent = `${goal} ${stableSymbol}`;

    const progress = cap === 0n ? 0 : Number(total * 10000n / cap) / 100;
    $('progressbar').style.width = `${Math.min(progress, 100)}%`;
    $('progress-label').textContent = `${progress.toFixed(2)}% of the soft cap · ${raised} / ${goal} mock ${stableSymbol}`;
    $('window').textContent = `${londonDate(saleStart)} → ${londonDate(saleEnd)}`;

    setLink('sale-link', C.genesisAddress);
    $('pol-address').textContent = valid(C.polVaultAddress) ? shortAddress(C.polVaultAddress) : '—';
    $('pol-address').title = valid(C.polVaultAddress) ? C.polVaultAddress : '';
    setLink('pol-address-link', C.polVaultAddress);
    setLink('sink-link', sinkAddress);
    setLink('sink-address-link', sinkAddress);
    setAddress('sink-address', sinkAddress);

    if (valid(sinkAddress)) {
      try {
        const sink = new E.Contract(sinkAddress, SINK, read);
        const [lp, router, pol] = await Promise.all([sink.totalLiquidity(), sink.router(), sink.polVault()]);
        $('lp-units').textContent = `${fmt(lp, 18, 8)} LP`;
        setAddress('router-address', router);
        if (valid(pol)) {
          $('pol-address').textContent = shortAddress(pol);
          $('pol-address').title = pol;
          setLink('pol-address-link', pol);
        }
      } catch {
        $('lp-units').textContent = '0 LP';
        $('router-address').textContent = 'Unavailable';
      }
    } else {
      $('lp-units').textContent = '0 LP';
      $('router-address').textContent = '—';
    }

    if (account) {
      const [contribution, allocation, claimed] = await Promise.all([
        contract.contributions(account), contract.estimateAllocation(account), contract.claimed(account)
      ]);
      $('contribution').textContent = `${fmt(contribution, stableDecimals)} ${stableSymbol}`;
      $('allocation').textContent = `${fmt(allocation, 18)} WELL7`;
      $('claim').disabled = !finalized || claimed || contribution === 0n;
      $('refund').disabled = !failed || contribution === 0n;
      $('connect').textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
    } else {
      $('contribution').textContent = 'Connect wallet';
      $('allocation').textContent = '—';
      $('claim').disabled = true;
      $('refund').disabled = true;
      $('connect').textContent = 'Connect Wallet';
    }

    renderCountdown();
    say(`Sale contract: ${C.genesisAddress} · last updated ${new Date().toLocaleTimeString('en-GB')}`, 'good');
  }

  async function restoreWallet() {
    if (!window.ethereum?.request) return false;
    if (window.DeepwellWalletSession?.isExplicitlyDisconnected?.()) {
      signer = null;
      account = '';
      $('connect').textContent = 'Connect Wallet';
      return false;
    }
    try {
      const [accounts, chainId] = await Promise.all([
        window.ethereum.request({ method: 'eth_accounts' }),
        window.ethereum.request({ method: 'eth_chainId' })
      ]);
      if (!accounts?.length || Number(BigInt(chainId)) !== 97) {
        signer = null;
        account = '';
        $('connect').textContent = 'Connect Wallet';
        return false;
      }
      const provider = new E.BrowserProvider(window.ethereum);
      signer = await provider.getSigner(accounts[0]);
      account = await signer.getAddress();
      $('connect').textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
      return true;
    } catch (error) {
      signer = null;
      account = '';
      $('connect').textContent = 'Connect Wallet';
      console.warn('Silent wallet restore', error);
      return false;
    }
  }

  async function connect() {
    if (!window.ethereum) throw new Error('Open this page in MetaMask or another EVM wallet.');
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    window.DeepwellWalletSession?.markConnected?.();
    const connected = await restoreWallet();
    if (!connected) throw new Error('Switch to BNB Smart Chain Testnet (chain 97).');
    await load();
  }

  async function send(transaction, label) {
    const tx = await transaction;
    say(`${label} submitted · waiting for confirmation…`);
    await tx.wait();
    await load().catch(error => console.warn('Refresh after confirmed transaction failed:', error));
    say(`${label} confirmed · ${tx.hash}`, 'good');
  }

  async function action(kind) {
    try {
      if (!signer) await connect();
      const sale = contract.connect(signer);

      if (kind === 'contribute') {
        const value = $('amount').value.trim();
        if (!/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) {
          throw new Error('Enter a positive mock tUSDT amount.');
        }
        const amount = E.parseUnits(value, stableDecimals);
        const token = stable.connect(signer);
        if (await token.allowance(account, C.genesisAddress) < amount) {
          say(`Approve exactly ${value} mock ${stableSymbol} in MetaMask. Then confirm the contribution.`);
          await send(token.approve(C.genesisAddress, amount), 'Approval');
        }
        await send(sale.contribute(amount), 'Contribution');
        return;
      }
      if (kind === 'finalize') return await send(sale.finalize(), 'Sale finalization');
      if (kind === 'claim') return await send(sale.claim(), 'WELL7 claim');
      if (kind === 'refund') return await send(sale.refund(), 'Mock tUSDT refund');
    } catch (error) {
      say(error.shortMessage || error.message, 'warn');
    }
  }

  function init() {
    $('connect').onclick = () => connect().catch(error => say(error.shortMessage || error.message, 'warn'));
    $('contribute').onclick = () => action('contribute');
    $('finalize').onclick = () => action('finalize');
    $('claim').onclick = () => action('claim');
    $('refund').onclick = () => action('refund');

    if (window.ethereum) {
      window.ethereum.on?.('accountsChanged', async () => {
        await restoreWallet();
        load().catch(error => say(error.shortMessage || error.message, 'warn'));
      });
      window.ethereum.on?.('chainChanged', () => location.reload());
    }

    Promise.resolve(window.DeepwellWalletSession?.ready).then(restoreWallet).finally(() => load().catch(error => say(error.shortMessage || error.message, 'warn')));
    window.setInterval(renderCountdown, 1000);
    window.setInterval(() => load().catch(error => console.warn(error)), 20000);
  }

  init();
})();
