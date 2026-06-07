package com.lwd.telemetry.netty;

import com.lwd.telemetry.mpt.MptFrameDecoder;
import com.lwd.telemetry.mpt.MptFrameListener;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.ChannelFuture;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.LengthFieldBasedFrameDecoder;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Slf4j
@Component
public class MptNettyServer {

    @Value("${netty.tcp.port:9600}")
    private int port;

    @Value("${netty.tcp.boss-threads:1}")
    private int bossThreads;

    @Value("${netty.tcp.worker-threads:4}")
    private int workerThreads;

    @Value("${netty.mpt.max-frame-length:65536}")
    private int maxFrameLength;

    private EventLoopGroup bossGroup;
    private EventLoopGroup workerGroup;
    private ChannelFuture channelFuture;

    private final MptFrameListener frameListener;

    public MptNettyServer(MptFrameListener frameListener) {
        this.frameListener = frameListener;
    }

    public void start() throws InterruptedException {
        bossGroup = new NioEventLoopGroup(bossThreads);
        workerGroup = new NioEventLoopGroup(workerThreads);

        ServerBootstrap bootstrap = new ServerBootstrap();
        bootstrap.group(bossGroup, workerGroup)
                .channel(NioServerSocketChannel.class)
                .childHandler(new ChannelInitializer<SocketChannel>() {
                    @Override
                    protected void initChannel(SocketChannel ch) throws Exception {
                        ch.pipeline()
                                .addLast("frameDecoder",
                                        new LengthFieldBasedFrameDecoder(maxFrameLength, 4, 4, -8, 0))
                                .addLast("mptDecoder", new MptFrameDecoder())
                                .addLast("mptHandler", new MptInboundHandler(frameListener));
                    }
                })
                .option(ChannelOption.SO_BACKLOG, 128)
                .childOption(ChannelOption.SO_KEEPALIVE, true)
                .childOption(ChannelOption.TCP_NODELAY, true);

        channelFuture = bootstrap.bind(port).sync();
        log.info("MPT Netty TCP server started on port {}", port);
    }

    @PreDestroy
    public void stop() {
        if (channelFuture != null) {
            channelFuture.channel().close().awaitUninterruptibly();
        }
        if (workerGroup != null) {
            workerGroup.shutdownGracefully();
        }
        if (bossGroup != null) {
            bossGroup.shutdownGracefully();
        }
        log.info("MPT Netty TCP server stopped");
    }
}
