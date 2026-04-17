.chat-jump-nav{
  position:absolute;
  left:50%;
  bottom:96px;
  transform:translateX(-50%) translateY(8px);
  z-index:20;
  pointer-events:none;
  opacity:0;
  transition:opacity 180ms ease, transform 180ms ease;
}

.chat-jump-nav.is-active{
  opacity:1;
  transform:translateX(-50%) translateY(0);
}

.chat-jump-nav.is-hidden{
  opacity:0;
  transform:translateX(-50%) translateY(8px);
}

.chat-jump-btn{
  pointer-events:auto;
  width:46px;
  height:46px;
  border:1px solid rgba(255,255,255,0.12);
  border-radius:999px;
  background:rgba(25,25,25,0.94);
  color:#fff;
  display:flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  box-shadow:0 10px 28px rgba(0,0,0,0.36);
  backdrop-filter:blur(8px);
  transition:transform 120ms ease, background 120ms ease, border-color 120ms ease;
}

.chat-jump-btn:hover{
  transform:translateY(-1px);
  background:rgba(35,35,35,0.98);
  border-color:rgba(255,255,255,0.18);
}

.chat-jump-btn-icon{
  font-size:22px;
  font-weight:900;
  line-height:1;
  transform:translateY(-1px);
}

@media (max-width: 640px){
  .chat-jump-nav{
    bottom:92px;
  }

  .chat-jump-btn{
    width:44px;
    height:44px;
  }

  .chat-jump-btn-icon{
    font-size:20px;
  }
}
